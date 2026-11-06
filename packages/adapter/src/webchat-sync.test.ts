import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-webchat-sync-test' };
});

const TEST_DATA = '/tmp/nanoclaw-webchat-sync-test';

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({
    WEBCHAT_ENABLED: 'true',
    WEBCHAT_USER_ID: 'web:local',
    WEBCHAT_DISPLAY_NAME: 'Local',
  })),
}));

vi.mock('./log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readEnvFile } from './env.js';
import { initTestDb, closeDb, runMigrations, createAgentGroup } from './db/index.js';
import {
  createMessagingGroup,
  getMessagingGroupByPlatform,
  getMessagingGroupAgents,
  getMessagingGroupAgentByPair,
  updateMessagingGroup,
} from './db/messaging-groups.js';
import {
  buildWebchatBootstrap,
  ensurePublicWebOwner,
  healWebchatWiringsForUser,
  readTeamFolder,
  revokeLegacyLocalWebApprovers,
  syncWebchatWirings,
  ensureUserWebchatWirings,
  WEB_CHANNEL_TYPE,
  WEB_INBOX_PLATFORM_ID,
  WEB_LOBBY_PLATFORM_ID,
} from './webchat-sync.js';
import { encodeUserSuffix } from './webchat-room-scope.js';
import { upsertUser, getUser } from './modules/permissions/db/users.js';
import * as agentGroupMembers from './modules/permissions/db/agent-group-members.js';
import { grantRole, isGlobalAdmin, isOwner } from './modules/permissions/db/user-roles.js';
import { upsertUserDm, getUserDm } from './modules/permissions/db/user-dms.js';
import { log } from './log.js';
import { appendMessage, createThread, ensureWebchatSchema, MAIN_THREAD } from './webchat-store.js';

const readEnvFileMock = vi.mocked(readEnvFile);

function resetWebchatData(): void {
  if (fs.existsSync(TEST_DATA)) {
    fs.rmSync(TEST_DATA, { recursive: true, force: true });
  }
}

function now(): string {
  return new Date().toISOString();
}

beforeEach(async () => {
  readEnvFileMock.mockReturnValue({
    WEBCHAT_ENABLED: 'true',
    WEBCHAT_USER_ID: 'web:local',
    WEBCHAT_DISPLAY_NAME: 'Local',
  });
  process.env.WEBCHAT_ENABLED = 'true';
  resetWebchatData();
  const db = await initTestDb();
  await runMigrations(db, undefined, { mode: 'migrate' });
  await ensureWebchatSchema();
});

afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.WEBCHAT_ENABLED;
  delete process.env.WEBCHAT_TEAM_FOLDER;
  delete process.env.WEBCHAT_USER_ID;
  delete process.env.WEBCHAT_DISPLAY_NAME;
  delete process.env.WEBCHAT_AUTH_MODE;
  await closeDb();
  resetWebchatData();
});

describe('readTeamFolder', () => {
  it('reads team folder from env or file', () => {
    process.env.WEBCHAT_TEAM_FOLDER = ' team-coord ';
    expect(readTeamFolder()).toBe('team-coord');
    delete process.env.WEBCHAT_TEAM_FOLDER;
    readEnvFileMock.mockReturnValue({ WEBCHAT_TEAM_FOLDER: 'from-file' });
    expect(readTeamFolder()).toBe('from-file');
    readEnvFileMock.mockReturnValue({});
    expect(readTeamFolder()).toBeNull();
  });
});

describe('buildWebchatBootstrap', () => {
  it('returns lobby + per-agent DM rooms with threads', async () => {
    await ensureWebchatSchema();
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    createThread('lobby', 'Topic');
    appendMessage({
      id: 'web-1',
      direction: 'inbound',
      text: 'hello',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });

    const payload = await buildWebchatBootstrap('web:user', 'User');
    expect(payload.user).toEqual({ id: 'web:user', displayName: 'User' });
    expect(payload.rooms[0]).toMatchObject({ platformId: 'inbox', kind: 'inbox' });
    expect(payload.rooms[1]).toMatchObject({ platformId: 'lobby', kind: 'lobby' });
    expect(payload.rooms.some((r) => r.platformId === 'dm:sarah' && r.kind === 'dm')).toBe(true);
    expect(payload.agents[0]).toMatchObject({ folder: 'sarah', mention: '@sarah' });
  });

  it('labels team folder agent as Team with @team mention', async () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    await createAgentGroup({
      id: 'ag-team',
      name: 'Coordinator',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });

    const payload = await buildWebchatBootstrap('web:local', 'Local');
    expect(payload.agents[0]).toMatchObject({ folder: 'team-coord', name: 'Team', mention: '@team' });
  });

  it('lists per-user DM storage ids in public auth mode', async () => {
    readEnvFileMock.mockReturnValue({
      WEBCHAT_AUTH_MODE: 'public',
      WEBCHAT_ENABLED: 'true',
    });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    const userId = 'web:basic:alice';
    const payload = await buildWebchatBootstrap(userId, 'Alice');
    const dm = payload.rooms.find((r) => r.kind === 'dm');
    expect(dm?.platformId).toBe('dm:sarah');
    expect(payload.rooms.find((r) => r.kind === 'inbox')?.platformId).toBe('inbox');
  });
});

describe('syncWebchatWirings', () => {
  it('creates lobby and DM wirings for each agent group', async () => {
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await createAgentGroup({
      id: 'ag-diego',
      name: 'Diego',
      folder: 'diego',
      agent_provider: null,
      created_at: now(),
    });

    await syncWebchatWirings();

    const inbox = await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_INBOX_PLATFORM_ID);
    expect(inbox).toBeDefined();
    expect(inbox!.is_group).toBe(0);

    const lobby = await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID);
    expect(lobby).toBeDefined();
    const lobbyAgents = await getMessagingGroupAgents(lobby!.id);
    expect(lobbyAgents).toHaveLength(2);
    expect(lobbyAgents.find((a) => a.agent_group_id === 'ag-sarah')?.engage_pattern).toBe('@sarah\\b');

    const dmSarah = await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah');
    expect(dmSarah).toBeDefined();
    expect(dmSarah!.is_group).toBe(0);
    expect((await getMessagingGroupAgentByPair(dmSarah!.id, 'ag-sarah'))?.engage_pattern).toBe('.');
  });

  it('normalizes inbox messaging group when it was incorrectly marked as group', async () => {
    await createMessagingGroup({
      id: 'mg-inbox',
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: WEB_INBOX_PLATFORM_ID,
      name: 'Inbox',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });

    await syncWebchatWirings();

    const inbox = await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_INBOX_PLATFORM_ID);
    expect(inbox?.is_group).toBe(0);
  });

  it('is idempotent on second run', async () => {
    await createAgentGroup({
      id: 'ag-1',
      name: 'One',
      folder: 'one',
      agent_provider: null,
      created_at: now(),
    });

    await syncWebchatWirings();
    await syncWebchatWirings();

    const lobby = (await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID))!;
    expect(await getMessagingGroupAgents(lobby.id)).toHaveLength(1);
  });

  it('adds wiring when a new agent group appears', async () => {
    await createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    await createAgentGroup({
      id: 'ag-b',
      name: 'B',
      folder: 'b',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    const lobby = (await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID))!;
    expect(await getMessagingGroupAgents(lobby.id)).toHaveLength(2);
  });

  it('no-ops when WEBCHAT_ENABLED is false or unset', async () => {
    await createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    process.env.WEBCHAT_ENABLED = 'false';
    await syncWebchatWirings();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();

    delete process.env.WEBCHAT_ENABLED;
    readEnvFileMock.mockReturnValue({});
    await syncWebchatWirings();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();

    readEnvFileMock.mockReturnValue({ WEBCHAT_ENABLED: 'false' });
    await syncWebchatWirings();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();
  });

  it('runs when WEBCHAT_ENABLED comes from env file only', async () => {
    delete process.env.WEBCHAT_ENABLED;
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:local',
      WEBCHAT_DISPLAY_NAME: 'Local',
    });
    await createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
  });

  it('reads user identity from env file when process env is unset', async () => {
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:from-file',
      WEBCHAT_DISPLAY_NAME: 'From File',
    });
    await createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
  });

  it('falls back to default user identity when env vars are missing', async () => {
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
    readEnvFileMock.mockReturnValue({ WEBCHAT_ENABLED: 'true' });
    await createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
  });

  it('uses team lobby pattern when WEBCHAT_TEAM_FOLDER matches agent', async () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    await createAgentGroup({
      id: 'ag-team',
      name: 'Team',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });

    await syncWebchatWirings();

    const lobby = (await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID))!;
    const wiring = (await getMessagingGroupAgents(lobby.id))[0];
    expect(wiring?.engage_pattern).toBe('@(team|team-coord)\\b');
  });

  it('corrects DM messaging group is_group flag on re-sync', async () => {
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await createMessagingGroup({
      id: 'mg-dm-sarah',
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: 'dm:sarah',
      name: 'Sarah',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });

    await syncWebchatWirings();

    const dmSarah = (await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah'))!;
    expect(dmSarah.is_group).toBe(0);
    await updateMessagingGroup(dmSarah.id, { is_group: 1 });
    await syncWebchatWirings();
    expect((await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah'))!.is_group).toBe(0);
  });

  it('backfills per-user inbox and DM wirings for web users in public auth mode', async () => {
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_AUTH_MODE: 'public',
    });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const userId = 'web:basic:alice';
    await upsertUser({
      id: userId,
      kind: 'web',
      display_name: 'Alice',
      created_at: now(),
    });
    await upsertUser({
      id: 'phone:+1555',
      kind: 'phone',
      display_name: 'Phone User',
      created_at: now(),
    });
    const bobId = 'web:basic:bob';
    await upsertUser({
      id: bobId,
      kind: 'web',
      display_name: null,
      created_at: now(),
    });

    await syncWebchatWirings();

    const suffix = encodeUserSuffix(userId);
    const bobSuffix = encodeUserSuffix(bobId);
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_INBOX_PLATFORM_ID)).toBeUndefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah')).toBeUndefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${suffix}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${suffix}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${bobSuffix}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${bobSuffix}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${encodeUserSuffix('phone:+1555')}`)).toBeUndefined();
    expect((await getUser(bobId))?.display_name).toBeNull();
  });

  it('continues backfill when wiring fails for one web user', async () => {
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_AUTH_MODE: 'public',
    });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const okId = 'web:basic:alice';
    const failId = 'web:basic:fail';
    await upsertUser({ id: okId, kind: 'web', display_name: 'Alice', created_at: now() });
    await upsertUser({ id: failId, kind: 'web', display_name: 'Fail', created_at: now() });

    const { addMember: realAddMember } = await vi.importActual<typeof agentGroupMembers>(
      './modules/permissions/db/agent-group-members.js',
    );
    vi.spyOn(agentGroupMembers, 'addMember').mockImplementation((row) => {
      if (row.user_id === failId) throw new Error('constraint');
      return realAddMember(row);
    });

    await syncWebchatWirings();

    const okSuffix = encodeUserSuffix(okId);
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${okSuffix}`)).toBeDefined();
    expect(vi.mocked(log.error)).toHaveBeenCalledWith(
      'Webchat sync: failed to wire user',
      expect.objectContaining({ userId: failId }),
    );
  });
});

describe('ensureUserWebchatWirings', () => {
  it('creates per-user inbox and DM messaging groups', async () => {
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await createAgentGroup({
      id: 'ag-diego',
      name: 'Diego',
      folder: 'diego',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    const userId = 'web:basic:alice';
    await ensureUserWebchatWirings(userId, 'Alice');

    const suffix = encodeUserSuffix(userId);
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${suffix}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${suffix}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:diego:${suffix}`)).toBeDefined();
  });

  it('uses team lobby pattern when team folder matches agent', async () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    await createAgentGroup({
      id: 'ag-team',
      name: 'Coordinator',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    const userId = 'web:basic:bob';
    await ensureUserWebchatWirings(userId, 'Bob');

    const lobby = (await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID))!;
    const wiring = (await getMessagingGroupAgents(lobby.id)).find((a) => a.agent_group_id === 'ag-team');
    expect(wiring?.engage_pattern).toBe('@(team|team-coord)\\b');
  });

  it('uses default lobby pattern for non-team agents when team folder is set', async () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    await createAgentGroup({
      id: 'ag-team',
      name: 'Coordinator',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    await ensureUserWebchatWirings('web:basic:alice', 'Alice');

    const lobby = (await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID))!;
    const sarahWiring = (await getMessagingGroupAgents(lobby.id)).find((a) => a.agent_group_id === 'ag-sarah');
    expect(sarahWiring?.engage_pattern).toBe('@sarah\\b');
  });

  it('skips lobby wiring when lobby messaging group has not been bootstrapped', async () => {
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const userId = 'web:basic:alice';
    await ensureUserWebchatWirings(userId, 'Alice');

    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${encodeUserSuffix(userId)}`)).toBeDefined();
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();
  });

  it('healWebchatWiringsForUser syncs lobby and only that user (not all web users)', async () => {
    process.env.WEBCHAT_AUTH_MODE = 'public';
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:local',
      WEBCHAT_DISPLAY_NAME: 'Local',
      WEBCHAT_AUTH_MODE: 'public',
    });

    await upsertUser({
      id: 'web:basic:bob',
      kind: 'web',
      display_name: 'Bob',
      created_at: now(),
    });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    await healWebchatWiringsForUser('web:basic:alice', 'Alice');

    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
    expect(
      await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${encodeUserSuffix('web:basic:alice')}`),
    ).toBeDefined();
    expect(
      await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${encodeUserSuffix('web:basic:alice')}`),
    ).toBeDefined();
    expect(
      await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${encodeUserSuffix('web:basic:bob')}`),
    ).toBeUndefined();
  });

  it('healWebchatWiringsForUser is a no-op when webchat is disabled', async () => {
    process.env.WEBCHAT_ENABLED = 'false';
    readEnvFileMock.mockReturnValue({ WEBCHAT_ENABLED: 'false' });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await healWebchatWiringsForUser('web:basic:alice', 'Alice');
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();
  });

  it('healWebchatWiringsForUser respects WEBCHAT_ENABLED from env file when process env is unset', async () => {
    delete process.env.WEBCHAT_ENABLED;
    readEnvFileMock.mockReturnValue({ WEBCHAT_ENABLED: 'false' });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await healWebchatWiringsForUser('web:basic:alice', 'Alice');
    expect(await getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();
  });

  it('grants owner to public web users and revokes legacy web:local owner/admin', async () => {
    process.env.WEBCHAT_AUTH_MODE = 'public';
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:local',
      WEBCHAT_DISPLAY_NAME: 'Local',
      WEBCHAT_AUTH_MODE: 'public',
    });

    await upsertUser({
      id: 'web:local',
      kind: 'web',
      display_name: 'Local',
      created_at: now(),
    });
    await grantRole({
      user_id: 'web:local',
      role: 'owner',
      agent_group_id: null,
      granted_by: null,
      granted_at: now(),
    });
    await grantRole({
      user_id: 'web:local',
      role: 'admin',
      agent_group_id: null,
      granted_by: null,
      granted_at: now(),
    });
    expect(await isOwner('web:local')).toBe(true);
    expect(await isGlobalAdmin('web:local')).toBe(true);

    const inboxMgId = 'mg-stale-inbox';
    await createMessagingGroup({
      id: inboxMgId,
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: WEB_INBOX_PLATFORM_ID,
      name: 'Inbox',
      is_group: 0,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });
    await upsertUserDm({
      user_id: 'web:local',
      channel_type: WEB_CHANNEL_TYPE,
      messaging_group_id: inboxMgId,
      resolved_at: now(),
    });

    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    const userId = 'web:github:2093195';
    await ensureUserWebchatWirings(userId, 'Brad');

    expect(await isOwner(userId)).toBe(true);
    expect(await isOwner('web:local')).toBe(false);
    expect(await isGlobalAdmin('web:local')).toBe(false);
    expect(await getUserDm('web:local', WEB_CHANNEL_TYPE)).toBeUndefined();
  });

  it('does not grant owner in local mode', async () => {
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await ensureUserWebchatWirings('web:basic:alice', 'Alice');
    expect(await isOwner('web:basic:alice')).toBe(false);
    // Direct calls cover the public-mode early returns (call sites skip them in local mode).
    await revokeLegacyLocalWebApprovers();
    ensurePublicWebOwner('web:basic:alice');
    expect(await isOwner('web:basic:alice')).toBe(false);
  });

  it('skips granting owner for legacy local identity and is idempotent for existing owners', async () => {
    process.env.WEBCHAT_AUTH_MODE = 'public';
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:local',
      WEBCHAT_DISPLAY_NAME: 'Local',
      WEBCHAT_AUTH_MODE: 'public',
    });
    await createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    await syncWebchatWirings();

    await ensureUserWebchatWirings('web:local', 'Local');
    expect(await isOwner('web:local')).toBe(false);

    await ensureUserWebchatWirings('web:basic:alice', 'Alice');
    expect(await isOwner('web:basic:alice')).toBe(true);
    await ensureUserWebchatWirings('web:basic:alice', 'Alice');
    expect(await isOwner('web:basic:alice')).toBe(true);
  });

  it('leaves user_dms alone when cached messaging group is not shared inbox', async () => {
    process.env.WEBCHAT_AUTH_MODE = 'public';
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:local',
      WEBCHAT_DISPLAY_NAME: 'Local',
      WEBCHAT_AUTH_MODE: 'public',
    });
    await upsertUser({
      id: 'web:local',
      kind: 'web',
      display_name: 'Local',
      created_at: now(),
    });
    await createMessagingGroup({
      id: 'mg-private-inbox',
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: `inbox:${encodeUserSuffix('web:local')}`,
      name: 'Inbox',
      is_group: 0,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });
    await upsertUserDm({
      user_id: 'web:local',
      channel_type: WEB_CHANNEL_TYPE,
      messaging_group_id: 'mg-private-inbox',
      resolved_at: now(),
    });
    await ensureUserWebchatWirings('web:local', 'Local');
    expect((await getUserDm('web:local', WEB_CHANNEL_TYPE))?.messaging_group_id).toBe('mg-private-inbox');
  });
});

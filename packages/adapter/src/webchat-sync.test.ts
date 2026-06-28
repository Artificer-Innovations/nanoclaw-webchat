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
  readTeamFolder,
  syncWebchatWirings,
  ensureUserWebchatWirings,
  WEB_CHANNEL_TYPE,
  WEB_INBOX_PLATFORM_ID,
  WEB_LOBBY_PLATFORM_ID,
} from './webchat-sync.js';
import { encodeUserSuffix } from './webchat-room-scope.js';
import { upsertUser } from './modules/permissions/db/users.js';
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

beforeEach(() => {
  readEnvFileMock.mockReturnValue({
    WEBCHAT_ENABLED: 'true',
    WEBCHAT_USER_ID: 'web:local',
    WEBCHAT_DISPLAY_NAME: 'Local',
  });
  process.env.WEBCHAT_ENABLED = 'true';
  resetWebchatData();
  const db = initTestDb();
  runMigrations(db);
  ensureWebchatSchema();
});

afterEach(() => {
  delete process.env.WEBCHAT_ENABLED;
  delete process.env.WEBCHAT_TEAM_FOLDER;
  delete process.env.WEBCHAT_USER_ID;
  delete process.env.WEBCHAT_DISPLAY_NAME;
  closeDb();
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
  it('returns lobby + per-agent DM rooms with threads', () => {
    ensureWebchatSchema();
    createAgentGroup({
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

    const payload = buildWebchatBootstrap('web:user', 'User');
    expect(payload.user).toEqual({ id: 'web:user', displayName: 'User' });
    expect(payload.rooms[0]).toMatchObject({ platformId: 'inbox', kind: 'inbox' });
    expect(payload.rooms[1]).toMatchObject({ platformId: 'lobby', kind: 'lobby' });
    expect(payload.rooms.some((r) => r.platformId === 'dm:sarah' && r.kind === 'dm')).toBe(true);
    expect(payload.agents[0]).toMatchObject({ folder: 'sarah', mention: '@sarah' });
  });

  it('labels team folder agent as Team with @team mention', () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    createAgentGroup({
      id: 'ag-team',
      name: 'Coordinator',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });

    const payload = buildWebchatBootstrap('web:local', 'Local');
    expect(payload.agents[0]).toMatchObject({ folder: 'team-coord', name: 'Team', mention: '@team' });
  });

  it('lists per-user DM storage ids in public auth mode', () => {
    readEnvFileMock.mockReturnValue({
      WEBCHAT_AUTH_MODE: 'public',
      WEBCHAT_ENABLED: 'true',
    });
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    const userId = 'web:basic:alice';
    const payload = buildWebchatBootstrap(userId, 'Alice');
    const dm = payload.rooms.find((r) => r.kind === 'dm');
    expect(dm?.platformId).toBe('dm:sarah');
    expect(payload.rooms.find((r) => r.kind === 'inbox')?.platformId).toBe('inbox');
  });
});

describe('syncWebchatWirings', () => {
  it('creates lobby and DM wirings for each agent group', () => {
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    createAgentGroup({
      id: 'ag-diego',
      name: 'Diego',
      folder: 'diego',
      agent_provider: null,
      created_at: now(),
    });

    syncWebchatWirings();

    const inbox = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_INBOX_PLATFORM_ID);
    expect(inbox).toBeDefined();
    expect(inbox!.is_group).toBe(0);

    const lobby = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID);
    expect(lobby).toBeDefined();
    const lobbyAgents = getMessagingGroupAgents(lobby!.id);
    expect(lobbyAgents).toHaveLength(2);
    expect(lobbyAgents.find((a) => a.agent_group_id === 'ag-sarah')?.engage_pattern).toBe('@sarah\\b');

    const dmSarah = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah');
    expect(dmSarah).toBeDefined();
    expect(dmSarah!.is_group).toBe(0);
    expect(getMessagingGroupAgentByPair(dmSarah!.id, 'ag-sarah')?.engage_pattern).toBe('.');
  });

  it('normalizes inbox messaging group when it was incorrectly marked as group', () => {
    createMessagingGroup({
      id: 'mg-inbox',
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: WEB_INBOX_PLATFORM_ID,
      name: 'Inbox',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });

    syncWebchatWirings();

    const inbox = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_INBOX_PLATFORM_ID);
    expect(inbox?.is_group).toBe(0);
  });

  it('is idempotent on second run', () => {
    createAgentGroup({
      id: 'ag-1',
      name: 'One',
      folder: 'one',
      agent_provider: null,
      created_at: now(),
    });

    syncWebchatWirings();
    syncWebchatWirings();

    const lobby = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)!;
    expect(getMessagingGroupAgents(lobby.id)).toHaveLength(1);
  });

  it('adds wiring when a new agent group appears', () => {
    createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();

    createAgentGroup({
      id: 'ag-b',
      name: 'B',
      folder: 'b',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();

    const lobby = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)!;
    expect(getMessagingGroupAgents(lobby.id)).toHaveLength(2);
  });

  it('no-ops when WEBCHAT_ENABLED is false or unset', () => {
    createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    process.env.WEBCHAT_ENABLED = 'false';
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();

    delete process.env.WEBCHAT_ENABLED;
    readEnvFileMock.mockReturnValue({});
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();

    readEnvFileMock.mockReturnValue({ WEBCHAT_ENABLED: 'false' });
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();
  });

  it('runs when WEBCHAT_ENABLED comes from env file only', () => {
    delete process.env.WEBCHAT_ENABLED;
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:local',
      WEBCHAT_DISPLAY_NAME: 'Local',
    });
    createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
  });

  it('reads user identity from env file when process env is unset', () => {
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_USER_ID: 'web:from-file',
      WEBCHAT_DISPLAY_NAME: 'From File',
    });
    createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
  });

  it('falls back to default user identity when env vars are missing', () => {
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
    readEnvFileMock.mockReturnValue({ WEBCHAT_ENABLED: 'true' });
    createAgentGroup({
      id: 'ag-a',
      name: 'A',
      folder: 'a',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
  });

  it('uses team lobby pattern when WEBCHAT_TEAM_FOLDER matches agent', () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    createAgentGroup({
      id: 'ag-team',
      name: 'Team',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });

    syncWebchatWirings();

    const lobby = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)!;
    const wiring = getMessagingGroupAgents(lobby.id)[0];
    expect(wiring?.engage_pattern).toBe('@(team|team-coord)\\b');
  });

  it('corrects DM messaging group is_group flag on re-sync', () => {
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    createMessagingGroup({
      id: 'mg-dm-sarah',
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: 'dm:sarah',
      name: 'Sarah',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: now(),
    });

    syncWebchatWirings();

    const dmSarah = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah')!;
    expect(dmSarah.is_group).toBe(0);
    updateMessagingGroup(dmSarah.id, { is_group: 1 });
    syncWebchatWirings();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah')!.is_group).toBe(0);
  });

  it('backfills per-user inbox and DM wirings for web users in public auth mode', () => {
    readEnvFileMock.mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_AUTH_MODE: 'public',
    });
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const userId = 'web:basic:alice';
    upsertUser({
      id: userId,
      kind: 'web',
      display_name: 'Alice',
      created_at: now(),
    });
    upsertUser({
      id: 'phone:+1555',
      kind: 'phone',
      display_name: 'Phone User',
      created_at: now(),
    });
    const bobId = 'web:basic:bob';
    upsertUser({
      id: bobId,
      kind: 'web',
      display_name: null,
      created_at: now(),
    });

    syncWebchatWirings();

    const suffix = encodeUserSuffix(userId);
    const bobSuffix = encodeUserSuffix(bobId);
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_INBOX_PLATFORM_ID)).toBeUndefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah')).toBeUndefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${suffix}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${suffix}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${bobSuffix}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${bobSuffix}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${encodeUserSuffix('phone:+1555')}`)).toBeUndefined();
  });
});

describe('ensureUserWebchatWirings', () => {
  it('creates per-user inbox and DM messaging groups', () => {
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    createAgentGroup({
      id: 'ag-diego',
      name: 'Diego',
      folder: 'diego',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();

    const userId = 'web:basic:alice';
    ensureUserWebchatWirings(userId, 'Alice');

    const suffix = encodeUserSuffix(userId);
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${suffix}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:sarah:${suffix}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `dm:diego:${suffix}`)).toBeDefined();
  });

  it('uses team lobby pattern when team folder matches agent', () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    createAgentGroup({
      id: 'ag-team',
      name: 'Coordinator',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();

    const userId = 'web:basic:bob';
    ensureUserWebchatWirings(userId, 'Bob');

    const lobby = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)!;
    const wiring = getMessagingGroupAgents(lobby.id).find((a) => a.agent_group_id === 'ag-team');
    expect(wiring?.engage_pattern).toBe('@(team|team-coord)\\b');
  });

  it('uses default lobby pattern for non-team agents when team folder is set', () => {
    process.env.WEBCHAT_TEAM_FOLDER = 'team-coord';
    createAgentGroup({
      id: 'ag-team',
      name: 'Coordinator',
      folder: 'team-coord',
      agent_provider: null,
      created_at: now(),
    });
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });
    syncWebchatWirings();

    ensureUserWebchatWirings('web:basic:alice', 'Alice');

    const lobby = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)!;
    const sarahWiring = getMessagingGroupAgents(lobby.id).find((a) => a.agent_group_id === 'ag-sarah');
    expect(sarahWiring?.engage_pattern).toBe('@sarah\\b');
  });

  it('skips lobby wiring when lobby messaging group has not been bootstrapped', () => {
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const userId = 'web:basic:alice';
    ensureUserWebchatWirings(userId, 'Alice');

    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, `inbox:${encodeUserSuffix(userId)}`)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeUndefined();
  });
});

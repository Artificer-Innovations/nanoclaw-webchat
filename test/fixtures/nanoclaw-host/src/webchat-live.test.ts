import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-webchat-live-test' };
});

const TEST_DATA = '/tmp/nanoclaw-webchat-live-test';

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
import { getMessagingGroupByPlatform } from './db/messaging-groups.js';
import { upsertUser } from './modules/permissions/db/users.js';
import {
  bootstrapPayloadForUser,
  refreshWebchatAfterAgentChange,
  setWebchatBootstrapBroadcaster,
} from './webchat-live.js';
import { WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID } from './webchat-sync.js';
import { ensureWebchatSchema } from './webchat-store.js';
import { log } from './log.js';

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
  delete process.env.WEBCHAT_AUTH_MODE;
  resetWebchatData();
  const db = initTestDb();
  runMigrations(db);
  ensureWebchatSchema();
  setWebchatBootstrapBroadcaster(null);
});

afterEach(() => {
  setWebchatBootstrapBroadcaster(null);
  vi.restoreAllMocks();
  delete process.env.WEBCHAT_ENABLED;
  delete process.env.WEBCHAT_AUTH_MODE;
  closeDb();
  resetWebchatData();
});

describe('refreshWebchatAfterAgentChange', () => {
  it('syncs wirings for newly created agents and invokes the broadcaster', () => {
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const broadcast = vi.fn();
    setWebchatBootstrapBroadcaster(broadcast);

    refreshWebchatAfterAgentChange();

    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)).toBeDefined();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:sarah')).toBeDefined();
    expect(broadcast).toHaveBeenCalledTimes(1);
  });

  it('still syncs when no broadcaster is registered', () => {
    createAgentGroup({
      id: 'ag-diego',
      name: 'Diego',
      folder: 'diego',
      agent_provider: null,
      created_at: now(),
    });

    refreshWebchatAfterAgentChange();
    expect(getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, 'dm:diego')).toBeDefined();
  });

  it('logs when the broadcaster throws', () => {
    createAgentGroup({
      id: 'ag-rahul',
      name: 'Rahul',
      folder: 'rahul',
      agent_provider: null,
      created_at: now(),
    });
    setWebchatBootstrapBroadcaster(() => {
      throw new Error('ws down');
    });

    refreshWebchatAfterAgentChange();
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      'Webchat live refresh: broadcast failed',
      expect.objectContaining({ err: expect.any(Error) }),
    );
  });
});

describe('bootstrapPayloadForUser', () => {
  it('uses the stored display name when present', () => {
    upsertUser({
      id: 'web:basic:alice',
      kind: 'web',
      display_name: 'Alice',
      created_at: now(),
    });
    createAgentGroup({
      id: 'ag-sarah',
      name: 'Sarah',
      folder: 'sarah',
      agent_provider: null,
      created_at: now(),
    });

    const payload = bootstrapPayloadForUser('web:basic:alice');
    expect(payload.user).toEqual({ id: 'web:basic:alice', displayName: 'Alice' });
    expect(payload.rooms.some((r) => r.kind === 'dm' && r.folder === 'sarah')).toBe(true);
  });
});

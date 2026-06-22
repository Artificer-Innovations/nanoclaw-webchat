import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./env.js', () => ({
  readEnvFile: () => ({
    WEBCHAT_ENABLED: 'true',
    WEBCHAT_USER_ID: 'web:local',
    WEBCHAT_DISPLAY_NAME: 'Local',
  }),
}));

vi.mock('./log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initTestDb, closeDb, runMigrations, createAgentGroup } from './db/index.js';
import {
  getMessagingGroupByPlatform,
  getMessagingGroupAgents,
  getMessagingGroupAgentByPair,
} from './db/messaging-groups.js';
import { syncWebchatWirings, WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID } from './webchat-sync.js';

function now(): string {
  return new Date().toISOString();
}

beforeEach(() => {
  process.env.WEBCHAT_ENABLED = 'true';
  const db = initTestDb();
  runMigrations(db);
});

afterEach(() => {
  delete process.env.WEBCHAT_ENABLED;
  closeDb();
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
});

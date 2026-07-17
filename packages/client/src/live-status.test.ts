import { describe, expect, it } from 'vitest';
import {
  applyActivityClearToLiveStatus,
  applyActivityToLiveStatus,
  applyTypingToLiveStatus,
  LIVE_ACTIVITY_MAX_AGE_MS,
  liveStatusList,
  pruneExpiredLiveStatus,
} from './live-status';
import type { AgentActivityEvent, WebChatAgent } from './types';

const agents: WebChatAgent[] = [
  { folder: 'sarah', name: 'Sarah', mention: '@sarah' },
  { folder: 'diego', name: 'Diego', mention: '@diego' },
];

function ev(partial: Partial<AgentActivityEvent> & Pick<AgentActivityEvent, 'kind' | 'summary'>): AgentActivityEvent {
  return {
    turnId: 't1',
    seq: 1,
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

describe('live-status', () => {
  it('keeps separate rows per agent folder', () => {
    let state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'tool_start', summary: 'Running Bash', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    state = applyActivityToLiveStatus(
      state,
      ev({ kind: 'tool_start', summary: 'Reading file', agentFolder: 'diego', agentName: 'Diego', turnId: 't2' }),
      agents,
    );
    const rows = liveStatusList(state);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['Diego', 'Sarah']);
  });

  it('removes row on turn_end', () => {
    let state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'tool_start', summary: 'Running Bash', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    state = applyActivityToLiveStatus(
      state,
      ev({ kind: 'turn_end', summary: 'Done', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    expect(liveStatusList(state)).toHaveLength(0);
  });

  it('applies typing to engaged folders', () => {
    const state = applyTypingToLiveStatus({}, ['sarah', 'diego'], agents, 1_000);
    const rows = liveStatusList(state, 1_500);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.typingUntil === 5_000)).toBe(true);
  });

  it('clears by turnId', () => {
    let state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'tool_start', summary: 'A', agentFolder: 'sarah', turnId: 'a' }),
      agents,
    );
    state = applyActivityToLiveStatus(
      state,
      ev({ kind: 'tool_start', summary: 'B', agentFolder: 'diego', turnId: 'b' }),
      agents,
    );
    state = applyActivityClearToLiveStatus(state, 'a');
    expect(liveStatusList(state).map((r) => r.folder)).toEqual(['diego']);
  });

  it('clears all when turnId omitted', () => {
    const state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'tool_start', summary: 'A', agentFolder: 'sarah' }),
      agents,
    );
    expect(Object.keys(applyActivityClearToLiveStatus(state, undefined))).toHaveLength(0);
  });

  it('prune returns same reference when nothing expired', () => {
    const state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'tool_start', summary: 'A', agentFolder: 'sarah' }),
      agents,
      1_000,
    );
    expect(pruneExpiredLiveStatus(state, 1_500)).toBe(state);
  });

  it('prune drops stale event-only rows (orphan turn without turn_end)', () => {
    const oldTs = new Date(Date.now() - LIVE_ACTIVITY_MAX_AGE_MS - 1_000).toISOString();
    const state = applyActivityToLiveStatus(
      {},
      ev({
        kind: 'tool_start',
        summary: 'A',
        agentFolder: 'sarah',
        timestamp: oldTs,
      }),
      agents,
      Date.now() - LIVE_ACTIVITY_MAX_AGE_MS - 1_000,
    );
    // typing window already expired; event older than max age → drop
    const pruned = pruneExpiredLiveStatus(state, Date.now());
    expect(pruned).toEqual({});
  });
});

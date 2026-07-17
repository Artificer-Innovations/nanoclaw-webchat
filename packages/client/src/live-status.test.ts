import { describe, expect, it } from 'vitest';
import {
  applyActivityClearToLiveStatus,
  applyActivityToLiveStatus,
  applyTypingToLiveStatus,
  coalescePartialText,
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
    const pruned = pruneExpiredLiveStatus(state, Date.now());
    expect(pruned).toEqual({});
  });

  it('coalesces partial_text deltas into one draft', () => {
    let state = applyActivityToLiveStatus(
      {},
      ev({
        kind: 'partial_text',
        summary: '<message>Hello',
        agentFolder: 'sarah',
        agentName: 'Sarah',
        seq: 1,
      }),
      agents,
    );
    state = applyActivityToLiveStatus(
      state,
      ev({
        kind: 'partial_text',
        summary: ' **world**',
        agentFolder: 'sarah',
        agentName: 'Sarah',
        seq: 2,
      }),
      agents,
    );
    expect(state.sarah?.partialText).toBe('Hello **world**');
  });

  it('uses cumulative snapshot when new partial starts with previous', () => {
    expect(coalescePartialText('Hello', 'Hello world')).toBe('Hello world');
  });

  it('clears partial draft when a tool event arrives', () => {
    let state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'partial_text', summary: 'Draft…', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    expect(state.sarah?.partialText).toBe('Draft…');
    state = applyActivityToLiveStatus(
      state,
      ev({ kind: 'tool_start', summary: 'Running Bash', tool: 'Bash', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    expect(state.sarah?.partialText).toBeUndefined();
    expect(state.sarah?.event?.kind).toBe('tool_start');
  });

  it('treats keepalive as typing-only (does not sticky Working text)', () => {
    const state = applyActivityToLiveStatus(
      {},
      ev({
        kind: 'keepalive',
        summary: 'Working',
        keepalive: true,
        agentFolder: 'sarah',
        agentName: 'Sarah',
      }),
      agents,
      1_000,
    );
    expect(state.sarah?.event).toBeUndefined();
    expect(state.sarah?.typingUntil).toBe(5_000);
    expect(liveStatusList(state, 1_500)).toHaveLength(1);
    expect(liveStatusList(state, 6_000)).toHaveLength(0);
  });

  it('turn_end clears prior turn_start on replay', () => {
    let state = applyActivityToLiveStatus(
      {},
      ev({ kind: 'turn_start', summary: 'Working…', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    state = applyActivityToLiveStatus(
      state,
      ev({ kind: 'turn_end', summary: 'Done', agentFolder: 'sarah', agentName: 'Sarah' }),
      agents,
    );
    expect(liveStatusList(state)).toHaveLength(0);
  });
});

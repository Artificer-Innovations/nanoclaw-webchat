import { describe, expect, it } from 'vitest';
import {
  applyActivityClearToLiveStatus,
  applyActivityToLiveStatus,
  applyTypingToLiveStatus,
  liveStatusList,
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
});

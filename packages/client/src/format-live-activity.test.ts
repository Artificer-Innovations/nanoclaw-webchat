import { describe, expect, it } from 'vitest';
import { formatLiveActivity } from './format-live-activity';
import type { AgentActivityEvent } from './types';

function ev(partial: Partial<AgentActivityEvent> & Pick<AgentActivityEvent, 'kind' | 'summary'>): AgentActivityEvent {
  return {
    turnId: 't1',
    seq: 1,
    timestamp: new Date().toISOString(),
    ...partial,
  };
}

describe('formatLiveActivity', () => {
  it('strips <internal> and uses thinking icon', () => {
    const out = formatLiveActivity('<internal>Considering next steps</internal>');
    expect(out).toEqual({ icon: 'thinking', text: 'Considering next steps' });
  });

  it('strips <message> and uses message icon', () => {
    const out = formatLiveActivity('<message>Drafting reply…</message>');
    expect(out).toEqual({ icon: 'message', text: 'Drafting reply…' });
  });

  it('decodes entities then strips tags', () => {
    const out = formatLiveActivity('&lt;internal&gt;Hmm&lt;/internal&gt;');
    expect(out).toEqual({ icon: 'thinking', text: 'Hmm' });
  });

  it('uses tool icon for tool_start events', () => {
    const out = formatLiveActivity('Running Bash', ev({ kind: 'tool_start', summary: 'Running Bash', tool: 'Bash' }));
    expect(out).toEqual({ icon: 'tool', text: 'Running Bash' });
  });

  it('returns null for empty/tag-only input', () => {
    expect(formatLiveActivity('<internal></internal>')).toBeNull();
    expect(formatLiveActivity('   ')).toBeNull();
  });
});

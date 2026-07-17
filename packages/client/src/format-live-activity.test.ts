import { describe, expect, it } from 'vitest';
import { cleanPartialChunk, formatLiveActivity } from './format-live-activity';
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
  it('strips <internal> and uses thinking icon (plain)', () => {
    const out = formatLiveActivity('<internal>Considering next steps</internal>');
    expect(out).toEqual({ icon: 'thinking', text: 'Considering next steps', markdown: false });
  });

  it('strips <message> and marks markdown', () => {
    const out = formatLiveActivity('<message>Drafting reply…</message>');
    expect(out).toEqual({ icon: 'message', text: 'Drafting reply…', markdown: true });
  });

  it('preserves markdown structure inside <message>', () => {
    const out = formatLiveActivity('<message>Hello **world**\n\n- item</message>');
    expect(out?.markdown).toBe(true);
    expect(out?.text).toBe('Hello **world**\n\n- item');
  });

  it('decodes entities then strips tags', () => {
    const out = formatLiveActivity('&lt;internal&gt;Hmm&lt;/internal&gt;');
    expect(out).toEqual({ icon: 'thinking', text: 'Hmm', markdown: false });
  });

  it('uses tool icon for tool_start events', () => {
    const out = formatLiveActivity('Running Bash', ev({ kind: 'tool_start', summary: 'Running Bash', tool: 'Bash' }));
    expect(out).toEqual({ icon: 'tool', text: 'Running Bash', markdown: false });
  });

  it('uses tool icon from tool_* tags', () => {
    expect(formatLiveActivity('<tool_call>Bash</tool_call>')?.icon).toBe('tool');
    expect(formatLiveActivity('<invoke>x</invoke>')?.icon).toBe('tool');
    expect(formatLiveActivity('<function>x</function>')?.icon).toBe('tool');
    expect(formatLiveActivity('<tool>x</tool>')?.icon).toBe('tool');
  });

  it('uses message icon from text/output tags', () => {
    expect(formatLiveActivity('<text>Hello</text>')?.icon).toBe('message');
    expect(formatLiveActivity('<output>Done</output>')?.icon).toBe('message');
  });

  it('marks partial_text as markdown', () => {
    const out = formatLiveActivity('Hello **x**', ev({ kind: 'partial_text', summary: 'Hello **x**' }));
    expect(out).toEqual({ icon: 'message', text: 'Hello **x**', markdown: true });
  });

  it('infers thinking/tool/generic icons from plain text', () => {
    expect(formatLiveActivity('thinking about next steps')?.icon).toBe('thinking');
    expect(formatLiveActivity('Running something')?.icon).toBe('tool');
    expect(formatLiveActivity('hello there')?.icon).toBe('generic');
  });

  it('uses thinking icon for reasoning_summary events', () => {
    expect(
      formatLiveActivity('plan', ev({ kind: 'reasoning_summary', summary: 'plan' }))?.icon,
    ).toBe('thinking');
  });

  it('uses tool icon for tool_progress/tool_end and bare tool field', () => {
    expect(
      formatLiveActivity('halfway', ev({ kind: 'tool_progress', summary: 'halfway', tool: 'Bash' }))
        ?.icon,
    ).toBe('tool');
    expect(
      formatLiveActivity('done', ev({ kind: 'tool_end', summary: 'done', tool: 'Bash' }))?.icon,
    ).toBe('tool');
    expect(formatLiveActivity('custom', ev({ kind: 'keepalive', summary: 'custom', tool: 'X' }))?.icon).toBe(
      'tool',
    );
  });

  it('falls back when strip leaves empty but raw had entities-only noise', () => {
    // Tags strip to empty → null after normalize
    expect(formatLiveActivity('<thought></thought>')).toBeNull();
    expect(formatLiveActivity('<message>  \n\n  </message>')).toBeNull();
  });

  it('returns null for empty/tag-only input', () => {
    expect(formatLiveActivity('<internal></internal>')).toBeNull();
    expect(formatLiveActivity('   ')).toBeNull();
    expect(formatLiveActivity(undefined)).toBeNull();
  });

  it('cleanPartialChunk preserves leading spaces and strips tags', () => {
    expect(cleanPartialChunk('<message>Hello')).toBe('Hello');
    expect(cleanPartialChunk(' **world**')).toBe(' **world**');
    expect(cleanPartialChunk('a\r\nb')).toBe('a\nb');
  });
});

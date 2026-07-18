import { describe, expect, it } from 'vitest';
import {
  cleanPartialChunk,
  cleanStreamDelta,
  collapseLiveActivity,
  finalizeActivityText,
  formatLiveActivity,
  LIVE_COLLAPSE_MIN_CHARS,
  LIVE_COLLAPSE_PREVIEW_CHARS,
} from './format-live-activity';
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

  it('decodes double-encoded entities before stripping wrappers', () => {
    const out = formatLiveActivity('&amp;lt;internal&amp;gt;Hmm&amp;lt;/internal&amp;gt;');
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

  it('cleanPartialChunk preserves leading spaces and strips complete tags', () => {
    expect(cleanPartialChunk('<message>Hello')).toBe('Hello');
    expect(cleanPartialChunk(' **world**')).toBe(' **world**');
    expect(cleanPartialChunk('a\r\nb')).toBe('a\nb');
    // Incomplete opens are kept so the next delta can finish the tag.
    expect(cleanPartialChunk('Hello <message')).toBe('Hello <message');
    expect(cleanPartialChunk('<mes')).toBe('<mes');
  });

  it('cleanStreamDelta keeps orphan tails for reassembly', () => {
    expect(cleanStreamDelta('sage>Hello')).toBe('sage>Hello');
    expect(cleanStreamDelta('<message>Hi')).toBe('Hi');
  });

  it('finalizeActivityText drops incomplete trailing wrappers', () => {
    expect(finalizeActivityText('Hello <message')).toBe('Hello ');
    expect(finalizeActivityText('Hello</mess')).toBe('Hello');
    expect(finalizeActivityText('<message to="lobby"')).toBe('');
    expect(formatLiveActivity('Draft <message')?.text).toBe('Draft');
  });

  it('strips orphaned known-tag tails after a split open tag', () => {
    expect(cleanPartialChunk('message>Hi')).toBe('Hi');
    expect(cleanPartialChunk('internal>Hmm')).toBe('Hmm');
    // Suffix orphans (missed first chunk, or mid-name split) strip too.
    expect(cleanPartialChunk('sage>Hello world')).toBe('Hello world');
    expect(finalizeActivityText('sage>Hello world')).toBe('Hello world');
  });

  it('formats incomplete task_progress summaries without leaking tags', () => {
    const out = formatLiveActivity(
      '<message>Still writing',
      ev({ kind: 'task_progress', summary: '<message>Still writing' }),
    );
    expect(out?.text).toBe('Still writing');
    expect(out?.markdown).toBe(true);
  });
});

describe('collapseLiveActivity', () => {
  it('leaves short text expanded', () => {
    const out = collapseLiveActivity('Quick thought.', ev({ kind: 'reasoning_summary', summary: 'x' }));
    expect(out.collapsible).toBe(false);
    expect(out.preview).toBe('Quick thought.');
  });

  it('collapses long reasoning with a first-sentence preview', () => {
    const text = `The user wants a refactor. ${'Detail sentence follows here. '.repeat(20)}`.trim();
    expect(text.length).toBeGreaterThan(LIVE_COLLAPSE_MIN_CHARS);
    const out = collapseLiveActivity(text, ev({ kind: 'reasoning_summary', summary: 'x' }));
    expect(out.collapsible).toBe(true);
    expect(out.preview).toBe('The user wants a refactor.');
  });

  it('collapses multi-paragraph text even under the char threshold', () => {
    const out = collapseLiveActivity('First paragraph.\n\nSecond paragraph.', ev({ kind: 'reasoning_summary', summary: 'x' }));
    expect(out.collapsible).toBe(true);
    expect(out.preview).toBe('First paragraph.');
  });

  it('truncates at a word boundary with ellipsis when no sentence fits', () => {
    const text = 'word '.repeat(100).trim();
    const out = collapseLiveActivity(text, ev({ kind: 'tool_end', summary: 'x' }));
    expect(out.collapsible).toBe(true);
    expect(out.preview.endsWith('…')).toBe(true);
    expect(out.preview.length).toBeLessThanOrEqual(LIVE_COLLAPSE_PREVIEW_CHARS + 1);
    expect(out.preview).not.toContain('\n');
  });

  it('never collapses streaming partial_text rows', () => {
    const text = 'streaming draft '.repeat(50);
    const out = collapseLiveActivity(text, ev({ kind: 'partial_text', summary: 'x' }));
    expect(out.collapsible).toBe(false);
  });

  it('collapses long text without an event and hard-cuts unbroken strings', () => {
    const out = collapseLiveActivity('x'.repeat(300));
    expect(out.collapsible).toBe(true);
    expect(out.preview).toBe(`${'x'.repeat(LIVE_COLLAPSE_PREVIEW_CHARS)}…`);
  });

  it('keeps a short multi-paragraph preview whole when it fits on one line', () => {
    const out = collapseLiveActivity('alpha beta\n\ngamma delta');
    expect(out.collapsible).toBe(true);
    expect(out.preview).toBe('alpha beta gamma delta');
  });

  it('falls back to char truncation when the first sentence exceeds the preview cap', () => {
    const text = `${'word '.repeat(40).trim()}. And then a second sentence follows with more detail.`;
    const out = collapseLiveActivity(text);
    expect(out.collapsible).toBe(true);
    expect(out.preview.endsWith('…')).toBe(true);
    expect(out.preview.length).toBeLessThanOrEqual(LIVE_COLLAPSE_PREVIEW_CHARS + 1);
  });
});

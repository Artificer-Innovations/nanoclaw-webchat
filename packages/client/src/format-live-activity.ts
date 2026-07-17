import type { AgentActivityEvent } from './types';

export type LiveActivityIcon = 'thinking' | 'tool' | 'message' | 'generic';

export interface FormattedLiveActivity {
  icon: LiveActivityIcon;
  text: string;
  /** Use FormattedMessage (GFM) instead of plain text. */
  markdown: boolean;
}

/** NanoClaw wrapper tags that may appear in streamed agent output. */
const KNOWN_WRAPPER_TAG_LIST = [
  'message',
  'internal',
  'thinking',
  'thought',
  'tool_call',
  'tool',
  'function',
  'invoke',
  'text',
  'output',
] as const;

const KNOWN_WRAPPER_TAGS = KNOWN_WRAPPER_TAG_LIST.join('|');

const TAG_RE = new RegExp(`<\\/?(?:${KNOWN_WRAPPER_TAGS})\\b[^>]*>`, 'gi');
/** Incomplete trailing open/close tag left by stream chunk boundaries (`<message`, `</mess`, `<mes`). */
const INCOMPLETE_TAG_TRAIL_RE = /<\/?[a-zA-Z][\w:-]*(?:\s[^>]*)?$/;
/**
 * Orphaned tag tail after a prior incomplete open was held across chunks
 * (`sage>` / `message>` from splitting `<message>`). Includes non-empty
 * suffixes so a missed first chunk still doesn't leak `sage>…` into the UI.
 */
const ORPHAN_TAG_TAIL_RE = (() => {
  const suffixes = new Set<string>();
  for (const tag of KNOWN_WRAPPER_TAG_LIST) {
    for (let i = 0; i < tag.length; i++) suffixes.add(tag.slice(i));
  }
  const alt = [...suffixes].sort((a, b) => b.length - a.length).join('|');
  return new RegExp(`^(?:${alt})\\b[^>]*>`, 'i');
})();

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'");
}

function stripCompleteTags(input: string): { tags: string[]; text: string } {
  const tags: string[] = [];
  const text = input.replace(TAG_RE, (match) => {
    tags.push(match.replace(/^<\/?([a-zA-Z][\w:-]*).*$/, '$1').toLowerCase());
    return '';
  });
  return { tags, text };
}

/**
 * Strip complete wrappers plus incomplete fragments (for display / post-coalesce).
 * Safe on fully reassembled stream text.
 */
export function stripActivityWrappers(input: string): { tags: string[]; text: string } {
  const decoded = decodeBasicEntities(input);
  const { tags, text: afterComplete } = stripCompleteTags(decoded);
  const text = afterComplete.replace(ORPHAN_TAG_TAIL_RE, '').replace(INCOMPLETE_TAG_TRAIL_RE, '');
  return { tags, text };
}

function normalizePlain(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeStructured(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function iconFromTags(tags: string[]): LiveActivityIcon | null {
  if (tags.some((t) => t === 'internal' || t === 'thinking' || t === 'thought')) return 'thinking';
  if (tags.some((t) => t === 'tool' || t === 'tool_call' || t === 'function' || t === 'invoke')) {
    return 'tool';
  }
  if (tags.some((t) => t === 'message' || t === 'text' || t === 'output')) return 'message';
  return null;
}

function iconFromEvent(event: AgentActivityEvent | undefined, text: string): LiveActivityIcon {
  const kind = event?.kind;
  if (kind === 'reasoning_summary') return 'thinking';
  if (
    kind === 'tool_start' ||
    kind === 'tool_progress' ||
    kind === 'tool_end' ||
    Boolean(event?.tool)
  ) {
    return 'tool';
  }
  if (kind === 'partial_text' || kind === 'task_progress') return 'message';
  if (/^running\b/i.test(text) || /\btool\b/i.test(text)) return 'tool';
  if (/\bthink/i.test(text)) return 'thinking';
  return 'generic';
}

function wantsMarkdown(icon: LiveActivityIcon, event?: AgentActivityEvent): boolean {
  return (
    icon === 'message' || event?.kind === 'partial_text' || event?.kind === 'task_progress'
  );
}

/**
 * Strip complete XML wrappers from a stream delta without trimming edges.
 * Leaves incomplete opens (`<mes`, `<message`) and orphan tails (`sage>`)
 * so the next chunk can finish the tag; call {@link cleanPartialChunk} after
 * coalescing, or {@link finalizeActivityText} for display.
 */
export function cleanStreamDelta(summary: string): string {
  const decoded = decodeBasicEntities(summary);
  const { text } = stripCompleteTags(decoded);
  return text.replace(/\r\n/g, '\n');
}

/**
 * Post-coalesce / standalone chunk cleanup: complete tags plus orphan tails
 * (`sage>` from a missed first half of `<message>`).
 */
export function cleanPartialChunk(summary: string): string {
  return cleanStreamDelta(summary).replace(ORPHAN_TAG_TAIL_RE, '');
}

/** Final pass after coalesce / for display — drops incomplete trailing wrappers too. */
export function finalizeActivityText(summary: string): string {
  return stripActivityWrappers(summary).text.replace(/\r\n/g, '\n');
}

/** Strip XML-ish wrappers and pick an icon for live activity display. */
export function formatLiveActivity(
  summary: string | undefined,
  event?: AgentActivityEvent,
): FormattedLiveActivity | null {
  const raw = summary?.trim();
  if (!raw) return null;
  const { tags, text: stripped } = stripActivityWrappers(raw);
  const icon = iconFromTags(tags) ?? iconFromEvent(event, normalizePlain(stripped));
  const markdown = wantsMarkdown(icon, event);
  const cleaned = markdown ? normalizeStructured(stripped) : normalizePlain(stripped);
  if (!cleaned) return null;
  return { icon, text: cleaned, markdown };
}

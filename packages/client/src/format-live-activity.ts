import type { AgentActivityEvent } from './types';

export type LiveActivityIcon = 'thinking' | 'tool' | 'message' | 'generic';

export interface FormattedLiveActivity {
  icon: LiveActivityIcon;
  text: string;
  /** Use FormattedMessage (GFM) instead of plain text. */
  markdown: boolean;
}

const TAG_RE = /<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g;

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'");
}

function stripTags(input: string): { tags: string[]; text: string } {
  const tags: string[] = [];
  const text = input.replace(TAG_RE, (_match, name: string) => {
    tags.push(name.toLowerCase());
    return '';
  });
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
  if (kind === 'partial_text') return 'message';
  if (/^running\b/i.test(text) || /\btool\b/i.test(text)) return 'tool';
  if (/\bthink/i.test(text)) return 'thinking';
  return 'generic';
}

function wantsMarkdown(icon: LiveActivityIcon, event?: AgentActivityEvent): boolean {
  return icon === 'message' || event?.kind === 'partial_text';
}

/**
 * Strip XML wrappers from a stream chunk without trimming edges —
 * leading/trailing spaces matter when appending deltas.
 */
export function cleanPartialChunk(summary: string): string {
  const decoded = decodeBasicEntities(summary);
  return stripTags(decoded).text.replace(/\r\n/g, '\n');
}

/** Strip XML-ish wrappers and pick an icon for live activity display. */
export function formatLiveActivity(
  summary: string | undefined,
  event?: AgentActivityEvent,
): FormattedLiveActivity | null {
  const raw = summary?.trim();
  if (!raw) return null;
  const decoded = decodeBasicEntities(raw);
  const { tags, text: stripped } = stripTags(decoded);
  const fallback = decodeBasicEntities(raw).replace(TAG_RE, '').trim();
  const icon = iconFromTags(tags) ?? iconFromEvent(event, normalizePlain(stripped || fallback));
  const markdown = wantsMarkdown(icon, event);
  const cleaned = markdown
    ? normalizeStructured(stripped || fallback)
    : normalizePlain(stripped || fallback);
  if (!cleaned) return null;
  return { icon, text: cleaned, markdown };
}

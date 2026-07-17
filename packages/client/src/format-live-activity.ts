import type { AgentActivityEvent } from './types';

export type LiveActivityIcon = 'thinking' | 'tool' | 'message' | 'generic';

export interface FormattedLiveActivity {
  icon: LiveActivityIcon;
  text: string;
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
  const text = input
    .replace(TAG_RE, (_match, name: string) => {
      tags.push(name.toLowerCase());
      return ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { tags, text };
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

/** Strip XML-ish wrappers and pick an icon for live activity display. */
export function formatLiveActivity(
  summary: string | undefined,
  event?: AgentActivityEvent,
): FormattedLiveActivity | null {
  const raw = summary?.trim();
  if (!raw) return null;
  const decoded = decodeBasicEntities(raw);
  const { tags, text } = stripTags(decoded);
  const cleaned = text || decoded.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return {
    icon: iconFromTags(tags) ?? iconFromEvent(event, cleaned),
    text: cleaned,
  };
}

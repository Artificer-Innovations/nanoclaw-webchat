import type { AgentActivityEvent, WebChatAgent } from './types';
import { cleanPartialChunk } from './format-live-activity';

export interface LiveAgentStatus {
  key: string;
  name: string;
  folder?: string;
  event?: AgentActivityEvent;
  /**
   * Accumulated partial_text for this agent/turn (stream deltas + snapshots).
   * Prefer this over `event.summary` when rendering message-like live rows.
   */
  partialText?: string;
  typingUntil: number;
}

/** Cap accumulated live draft so reconnect/UI stays bounded. */
export const MAX_LIVE_PARTIAL_CHARS = 6_000;

/**
 * Merge a new partial_text chunk into prior accumulated text.
 * Handles both cumulative snapshots (new starts with prev) and raw deltas (append).
 */
export function coalescePartialText(prev: string | undefined, chunk: string): string {
  const next = chunk;
  if (!next) return (prev ?? '').slice(-MAX_LIVE_PARTIAL_CHARS);
  if (!prev) return next.slice(-MAX_LIVE_PARTIAL_CHARS);
  if (next.startsWith(prev)) return next.slice(-MAX_LIVE_PARTIAL_CHARS);
  if (prev.startsWith(next)) return prev;
  if (prev.endsWith(next)) return prev;
  return (prev + next).slice(-MAX_LIVE_PARTIAL_CHARS);
}

export function liveAgentKey(event: Pick<AgentActivityEvent, 'agentFolder' | 'agentName' | 'turnId'>): string {
  if (event.agentFolder?.trim()) return event.agentFolder.trim();
  if (event.agentName?.trim()) return `name:${event.agentName.trim().toLowerCase()}`;
  return `turn:${event.turnId}`;
}

export function resolveLiveAgentName(
  event: Pick<AgentActivityEvent, 'agentFolder' | 'agentName'>,
  agents: readonly WebChatAgent[],
): string {
  if (event.agentName?.trim()) return event.agentName.trim();
  if (event.agentFolder) {
    const match = agents.find((a) => a.folder === event.agentFolder);
    if (match) return match.name;
    return event.agentFolder;
  }
  return 'Agent';
}

export function applyActivityToLiveStatus(
  prev: Record<string, LiveAgentStatus>,
  event: AgentActivityEvent,
  agents: readonly WebChatAgent[],
  now = Date.now(),
): Record<string, LiveAgentStatus> {
  const key = liveAgentKey(event);
  const name = resolveLiveAgentName(event, agents);
  if (event.kind === 'turn_end') {
    const next = { ...prev };
    delete next[key];
    return next;
  }

  const existing = prev[key];
  const typingUntil = Math.max(existing?.typingUntil ?? 0, now + 4000);

  // Keepalives only refresh the typing indicator — never become the sticky
  // "Working" row by themselves (idle warm containers used to leave ghosts).
  if (event.kind === 'keepalive') {
    return {
      ...prev,
      [key]: {
        key,
        name,
        folder: event.agentFolder ?? existing?.folder,
        event: existing?.event,
        partialText: existing?.partialText,
        typingUntil,
      },
    };
  }

  if (event.kind === 'partial_text') {
    const chunk = cleanPartialChunk(event.summary);
    const sameTurn = existing?.event?.turnId === event.turnId;
    return {
      ...prev,
      [key]: {
        key,
        name,
        folder: event.agentFolder,
        event,
        partialText: coalescePartialText(sameTurn ? existing?.partialText : undefined, chunk),
        typingUntil,
      },
    };
  }

  return {
    ...prev,
    [key]: {
      key,
      name,
      folder: event.agentFolder,
      event,
      typingUntil,
    },
  };
}

export function applyActivityClearToLiveStatus(
  prev: Record<string, LiveAgentStatus>,
  turnId?: string,
): Record<string, LiveAgentStatus> {
  if (!turnId) return {};
  const next: Record<string, LiveAgentStatus> = {};
  for (const [key, row] of Object.entries(prev)) {
    if (row.event?.turnId !== turnId) next[key] = row;
  }
  return next;
}

export function applyTypingToLiveStatus(
  prev: Record<string, LiveAgentStatus>,
  agentFolders: string[] | undefined,
  agents: readonly WebChatAgent[],
  now = Date.now(),
): Record<string, LiveAgentStatus> {
  const until = now + 4000;
  const next = { ...prev };

  const folders =
    agentFolders && agentFolders.length > 0
      ? agentFolders
      : Object.values(prev)
          .map((row) => row.folder)
          .filter((f): f is string => Boolean(f));

  if (folders.length === 0) {
    const key = 'agent';
    next[key] = {
      key,
      name: 'Agent',
      typingUntil: until,
      event: next[key]?.event,
      partialText: next[key]?.partialText,
    };
    return next;
  }

  for (const folder of folders) {
    const match = agents.find((a) => a.folder === folder);
    const existing = next[folder];
    next[folder] = {
      key: folder,
      name: match?.name ?? existing?.name ?? folder,
      folder,
      event: existing?.event,
      partialText: existing?.partialText,
      typingUntil: until,
    };
  }
  return next;
}

/** Drop orphan activity rows (no turn_end) after this age so reconnect ghosts don't stick. */
export const LIVE_ACTIVITY_MAX_AGE_MS = 90_000;

export function pruneExpiredLiveStatus(
  prev: Record<string, LiveAgentStatus>,
  now = Date.now(),
): Record<string, LiveAgentStatus> {
  let changed = false;
  const next: Record<string, LiveAgentStatus> = {};
  for (const [key, row] of Object.entries(prev)) {
    const typing = row.typingUntil > now;
    const eventAgeMs = row.event ? now - Date.parse(row.event.timestamp) : Infinity;
    const eventFresh = Boolean(row.event) && Number.isFinite(eventAgeMs) && eventAgeMs < LIVE_ACTIVITY_MAX_AGE_MS;
    if (typing || eventFresh) {
      next[key] = row;
    } else {
      changed = true;
    }
  }
  if (!changed && Object.keys(next).length === Object.keys(prev).length) return prev;
  return next;
}

export function liveStatusList(
  live: Record<string, LiveAgentStatus>,
  now = Date.now(),
): LiveAgentStatus[] {
  return Object.values(live)
    .filter((row) => row.event || row.typingUntil > now)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function clearLiveStatusForSender(
  prev: Record<string, LiveAgentStatus>,
  senderName: string | undefined,
  senderFolder: string | undefined,
): Record<string, LiveAgentStatus> {
  if (!senderName && !senderFolder) return prev;
  const nameNorm = senderName?.trim().toLowerCase();
  const next: Record<string, LiveAgentStatus> = {};
  for (const [key, row] of Object.entries(prev)) {
    if (senderFolder && row.folder === senderFolder) continue;
    if (nameNorm && row.name.trim().toLowerCase() === nameNorm) continue;
    if (nameNorm && row.folder?.toLowerCase() === nameNorm) continue;
    next[key] = row;
  }
  return next;
}

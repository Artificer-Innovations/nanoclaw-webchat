import type { AgentActivityEvent, WebChatAgent } from './types';

export interface LiveAgentStatus {
  key: string;
  name: string;
  folder?: string;
  event?: AgentActivityEvent;
  typingUntil: number;
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
  return {
    ...prev,
    [key]: {
      key,
      name,
      folder: event.agentFolder,
      event,
      typingUntil: Math.max(prev[key]?.typingUntil ?? 0, now + 4000),
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
      typingUntil: until,
    };
  }
  return next;
}

export function pruneExpiredLiveStatus(
  prev: Record<string, LiveAgentStatus>,
  now = Date.now(),
): Record<string, LiveAgentStatus> {
  const next: Record<string, LiveAgentStatus> = {};
  for (const [key, row] of Object.entries(prev)) {
    const typing = row.typingUntil > now;
    if (typing || row.event) next[key] = row;
  }
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
  const next: Record<string, LiveAgentStatus> = {};
  for (const [key, row] of Object.entries(prev)) {
    if (senderFolder && row.folder === senderFolder) continue;
    if (senderName && row.name === senderName) continue;
    next[key] = row;
  }
  return next;
}

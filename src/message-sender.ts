import type { WebChatAgent, WebChatMessage, WebChatRoom } from './types';
import { MENTION_HANDLE_PATTERN } from './mention-pattern';

function agentForHandle(handle: string, agents: WebChatAgent[]): WebChatAgent | undefined {
  const lower = handle.toLowerCase();
  return agents.find((a) => {
    const mentionHandle = a.mention.replace(/^@/, '').toLowerCase();
    return mentionHandle === lower || a.folder.toLowerCase() === lower;
  });
}

export function mentionedFoldersInOrder(text: string, agents: WebChatAgent[]): string[] {
  const folders: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(MENTION_HANDLE_PATTERN.source, MENTION_HANDLE_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const handle = match[1]!.toLowerCase();
    if (handle === 'here') continue;
    const agent = agentForHandle(handle, agents);
    if (!agent || seen.has(agent.folder)) continue;
    seen.add(agent.folder);
    folders.push(agent.folder);
  }
  return folders;
}

export function mergeEngagedAgents(
  current: readonly string[],
  text: string,
  agents: WebChatAgent[],
): string[] {
  const fromText = mentionedFoldersInOrder(text, agents);
  if (fromText.length === 0) return [...current];
  const merged = [...current];
  const seen = new Set(current);
  for (const folder of fromText) {
    if (!seen.has(folder)) {
      merged.push(folder);
      seen.add(folder);
    }
  }
  return merged;
}

export function engagedStateAfterSend(
  prev: Record<string, string[]>,
  engagedKey: string,
  text: string,
  agents: WebChatAgent[],
): Record<string, string[]> {
  return {
    ...prev,
    [engagedKey]: mergeEngagedAgents(prev[engagedKey] ?? [], text, agents),
  };
}

export function mentionFromText(text: string, agents: WebChatAgent[]): string | null {
  const ordered = mentionsInOrder(text, agents);
  return ordered[0] ?? null;
}

export function mentionsInOrder(text: string, agents: WebChatAgent[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = new RegExp(MENTION_HANDLE_PATTERN.source, MENTION_HANDLE_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const handle = match[1]!.toLowerCase();
    if (handle === 'here') continue;
    const agent = agentForHandle(handle, agents);
    if (!agent || seen.has(agent.folder)) continue;
    seen.add(agent.folder);
    names.push(agent.name);
  }
  return names;
}

function lobbySenderFromMentions(
  message: WebChatMessage,
  messages: WebChatMessage[],
  agents: WebChatAgent[],
): string | null {
  const messageIndex = messages.findIndex((m) => m.id === message.id);
  const prior = messageIndex >= 0 ? messages.slice(0, messageIndex + 1) : messages;

  let triggerIndex = -1;
  let mentions: string[] = [];
  for (let i = prior.length - 1; i >= 0; i--) {
    const inbound = prior[i];
    if (inbound?.direction !== 'inbound') continue;
    mentions = mentionsInOrder(inbound.text, agents);
    if (mentions.length > 0) {
      triggerIndex = i;
      break;
    }
  }
  if (triggerIndex < 0 || mentions.length === 0) return null;

  let outboundCount = 0;
  for (let i = triggerIndex + 1; i < prior.length; i++) {
    if (prior[i]?.direction === 'outbound') outboundCount++;
  }

  const idx = outboundCount - 1;
  if (idx >= 0 && idx < mentions.length) return mentions[idx]!;
  return mentions.length === 1 ? mentions[0]! : null;
}

export function messageSenderLabel(
  message: WebChatMessage,
  messages: WebChatMessage[],
  room: WebChatRoom | null,
  agents: WebChatAgent[],
): string {
  if (message.direction === 'inbound') return 'You';
  if (message.senderName?.trim()) return message.senderName.trim();
  if (room?.kind === 'dm') return room.name;

  const fromMentions = lobbySenderFromMentions(message, messages, agents);
  if (fromMentions) return fromMentions;

  return 'Agent';
}

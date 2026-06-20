import type { ThreadMeta } from './api';
import type { WebChatMessage, WebChatRoom } from './types';

export function resolveActiveThreadTitle(
  threads: ThreadMeta[] | undefined,
  threadId: string,
): string | null {
  if (threadId === 'main') return null;
  const match = threads?.find((t) => t.id === threadId);
  return match ? match.title : null;
}

export function threadsFromState(
  threadsByRoom: Record<string, ThreadMeta[]>,
  platformId: string,
): ThreadMeta[] {
  return threadsByRoom[platformId] ?? [];
}

export function threadsForRoom(
  threadsByRoom: Record<string, ThreadMeta[]>,
  platformId: string,
  loadRoomThreads: (platformId: string) => ThreadMeta[],
): ThreadMeta[] {
  return threadsByRoom[platformId] ?? loadRoomThreads(platformId);
}

export function canSendMessage(
  token: string,
  room: WebChatRoom | null,
  draft: string,
  sending: boolean,
): room is WebChatRoom {
  return Boolean(token && room && draft.trim() && !sending);
}

export function canCreateThread(room: WebChatRoom | null): room is WebChatRoom {
  return room !== null;
}

export function shouldAppendMessage(
  messages: WebChatMessage[],
  message: WebChatMessage,
  room: WebChatRoom | null,
  threadId: string,
): boolean {
  if (messages.some((m) => m.id === message.id)) return false;
  return isActiveConversation(message, room, threadId);
}

export function unreadKey(platformId: string, threadId: string): string {
  return `${platformId}:${threadId}`;
}

export function isActiveConversation(
  message: WebChatMessage,
  room: WebChatRoom | null,
  threadId: string,
): boolean {
  return Boolean(
    room &&
      message.platformId === room.platformId &&
      message.threadId === threadId,
  );
}

export function incrementUnread(
  counts: Record<string, number>,
  message: WebChatMessage,
  seenIds: Set<string>,
): Record<string, number> {
  if (seenIds.has(message.id)) return counts;
  seenIds.add(message.id);
  const key = unreadKey(message.platformId, message.threadId);
  return { ...counts, [key]: (counts[key] ?? 0) + 1 };
}

export function clearUnread(
  counts: Record<string, number>,
  platformId: string,
  threadId: string,
): Record<string, number> {
  const key = unreadKey(platformId, threadId);
  if (!(key in counts)) return counts;
  const next = { ...counts };
  delete next[key];
  return next;
}

export function getUnreadCount(
  counts: Record<string, number>,
  platformId: string,
  threadId: string,
): number {
  return counts[unreadKey(platformId, threadId)] ?? 0;
}

export function formatUnreadCount(count: number): string {
  if (count > 99) return '99+';
  return String(count);
}

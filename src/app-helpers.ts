import type { ThreadMeta } from './api';
import type { BootstrapPayload, WebChatMessage, WebChatRoom } from './types';

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

export function applyUnreadFromMessages(
  counts: Record<string, number>,
  messages: WebChatMessage[],
  seenIds: Set<string>,
): { counts: Record<string, number>; maxTimestamp: number } {
  let next = counts;
  let maxTimestamp = 0;
  for (const msg of messages) {
    maxTimestamp = Math.max(maxTimestamp, msg.timestamp);
    next = incrementUnread(next, msg, seenIds);
  }
  return { counts: next, maxTimestamp };
}

export function seedSyncCursors(
  cursors: Record<string, number>,
  rooms: WebChatRoom[],
  threadsByRoom: Record<string, ThreadMeta[]>,
  baseline = Date.now(),
): Record<string, number> {
  const next = { ...cursors };
  for (const room of rooms) {
    const threads = threadsByRoom[room.platformId] ?? [{ id: 'main', title: 'Main' }];
    for (const thread of threads) {
      next[unreadKey(room.platformId, thread.id)] = baseline;
    }
  }
  return next;
}

export function markMessagesSeen(messages: WebChatMessage[], seenIds: Set<string>): number {
  let maxTimestamp = 0;
  for (const msg of messages) {
    seenIds.add(msg.id);
    maxTimestamp = Math.max(maxTimestamp, msg.timestamp);
  }
  return maxTimestamp;
}

export function updateSyncCursor(
  syncCursor: Record<string, number>,
  platformId: string,
  threadId: string,
  maxTimestamp: number,
): Record<string, number> {
  if (maxTimestamp <= 0) return syncCursor;
  const key = unreadKey(platformId, threadId);
  return { ...syncCursor, [key]: Math.max(syncCursor[key] ?? 0, maxTimestamp) };
}

export async function syncInactiveUnread(
  token: string,
  bootstrap: BootstrapPayload,
  threadsByRoom: Record<string, ThreadMeta[]>,
  activeRoom: WebChatRoom | null,
  activeThreadId: string,
  syncCursor: Record<string, number>,
  seenIds: Set<string>,
  fetchMessagesFn: (
    authToken: string,
    platformId: string,
    threadId: string,
    since?: number,
  ) => Promise<WebChatMessage[]>,
  missingCursorBaseline = Date.now(),
): Promise<{ counts: Record<string, number>; syncCursor: Record<string, number> }> {
  let nextCounts: Record<string, number> = {};
  let nextCursor = syncCursor;

  for (const targetRoom of bootstrap.rooms) {
    const threads = threadsByRoom[targetRoom.platformId] ?? [{ id: 'main', title: 'Main' }];
    for (const thread of threads) {
      if (activeRoom?.platformId === targetRoom.platformId && activeThreadId === thread.id) {
        continue;
      }

      const key = unreadKey(targetRoom.platformId, thread.id);
      const since = nextCursor[key] ?? missingCursorBaseline;
      try {
        const msgs = await fetchMessagesFn(token, targetRoom.platformId, thread.id, since);
        if (msgs.length === 0) continue;
        const result = applyUnreadFromMessages(nextCounts, msgs, seenIds);
        nextCounts = result.counts;
        nextCursor = { ...nextCursor, [key]: Math.max(since, result.maxTimestamp) };
      } catch {
        // ignore transient sync errors
      }
    }
  }

  return { counts: nextCounts, syncCursor: nextCursor };
}

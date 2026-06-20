import type { ThreadMeta } from './types';
import type { BootstrapPayload, WebChatMessage, WebChatRoom } from './types';
import { clearLegacyThreads, createThread, loadLegacyThreads } from './api';

export const SEEN_MESSAGE_IDS_MAX = 1000;

export const DEFAULT_ROOM_THREADS: ThreadMeta[] = [{ id: 'main', title: 'Main' }];

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

export function defaultRoomThreads(_platformId: string): ThreadMeta[] {
  return DEFAULT_ROOM_THREADS;
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
  attachmentCount = 0,
): room is WebChatRoom {
  return Boolean(token && room && !sending && (draft.trim() || attachmentCount > 0));
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

/** Separator avoids collisions when platformId contains ":" (e.g. dm:rahul). */
export function unreadKey(platformId: string, threadId: string): string {
  return `${platformId}|${threadId}`;
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

export function trackSeenMessageId(seenIds: Set<string>, messageId: string): void {
  if (seenIds.has(messageId)) return;
  seenIds.add(messageId);
  while (seenIds.size > SEEN_MESSAGE_IDS_MAX) {
    const oldest = seenIds.values().next().value as string;
    seenIds.delete(oldest);
  }
}

export function activeUnreadKey(room: WebChatRoom | null, threadId: string): string | null {
  return room ? unreadKey(room.platformId, threadId) : null;
}

export function incrementUnread(
  counts: Record<string, number>,
  message: WebChatMessage,
): Record<string, number> {
  const key = unreadKey(message.platformId, message.threadId);
  return { ...counts, [key]: (counts[key] ?? 0) + 1 };
}

export function mergeUnreadDeltas(
  prev: Record<string, number>,
  deltas: Record<string, number>,
  activeKey: string | null,
): Record<string, number> {
  const next = { ...prev };
  for (const [key, count] of Object.entries(deltas)) {
    if (key === activeKey) continue;
    next[key] = (prev[key] ?? 0) + count;
  }
  return next;
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

export function formatUnreadAriaLabel(name: string, count: number): string {
  if (count <= 0) return name;
  const unread =
    count === 1 ? '1 unread message' : `${formatUnreadCount(count)} unread messages`;
  return `${name}, ${unread}`;
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
    if (seenIds.has(msg.id)) continue;
    trackSeenMessageId(seenIds, msg.id);
    next = incrementUnread(next, msg);
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
    trackSeenMessageId(seenIds, msg.id);
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

  const workItems: Array<{
    platformId: string;
    threadId: string;
    key: string;
    since: number;
  }> = [];

  for (const targetRoom of bootstrap.rooms) {
    const threads = threadsByRoom[targetRoom.platformId] ?? [{ id: 'main', title: 'Main' }];
    for (const thread of threads) {
      if (activeRoom?.platformId === targetRoom.platformId && activeThreadId === thread.id) {
        continue;
      }
      const key = unreadKey(targetRoom.platformId, thread.id);
      const since = nextCursor[key] ?? missingCursorBaseline;
      workItems.push({
        platformId: targetRoom.platformId,
        threadId: thread.id,
        key,
        since,
      });
    }
  }

  const fetches = await Promise.allSettled(
    workItems.map(async ({ platformId, threadId, key, since }) => {
      const msgs = await fetchMessagesFn(token, platformId, threadId, since);
      return { key, since, msgs };
    }),
  );

  for (const result of fetches) {
    if (result.status !== 'fulfilled') continue;
    const { key, since, msgs } = result.value;
    if (msgs.length === 0) continue;
    const applied = applyUnreadFromMessages(nextCounts, msgs, seenIds);
    nextCounts = applied.counts;
    nextCursor = { ...nextCursor, [key]: Math.max(since, applied.maxTimestamp) };
  }

  return { counts: nextCounts, syncCursor: nextCursor };
}

export function appendThreadToRoomMap(
  prev: Record<string, ThreadMeta[]>,
  platformId: string,
  thread: ThreadMeta,
): Record<string, ThreadMeta[]> {
  const base = prev[platformId] ?? DEFAULT_ROOM_THREADS;
  return {
    ...prev,
    [platformId]: [...base, thread],
  };
}

export async function migrateLegacyThreads(
  token: string,
  rooms: WebChatRoom[],
  baseMap: Record<string, ThreadMeta[]>,
): Promise<Record<string, ThreadMeta[]>> {
  const map = { ...baseMap };
  for (const room of rooms) {
    const server = map[room.platformId] ?? DEFAULT_ROOM_THREADS;
    const legacy = loadLegacyThreads(room.platformId);
    const hasOnlyMain = server.filter((t) => t.id !== 'main').length === 0;
    if (legacy.length === 0 || !hasOnlyMain) continue;
    const next = [...server];
    for (const thread of legacy) {
      const created = await createThread(token, room.platformId, thread.title);
      next.push(created);
    }
    map[room.platformId] = next;
    clearLegacyThreads(room.platformId);
  }
  return map;
}

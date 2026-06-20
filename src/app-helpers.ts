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
  return Boolean(
    room &&
      message.platformId === room.platformId &&
      message.threadId === threadId,
  );
}

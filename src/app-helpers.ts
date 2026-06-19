import type { WebChatMessage, WebChatRoom } from './types';

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

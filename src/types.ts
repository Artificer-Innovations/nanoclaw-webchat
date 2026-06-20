export interface WebChatUser {
  id: string;
  displayName: string;
}

export interface WebChatRoom {
  platformId: string;
  name: string;
  kind: 'lobby' | 'dm';
  folder?: string;
  threads?: ThreadMeta[];
}

export interface WebChatAgent {
  folder: string;
  name: string;
  mention: string;
}

export interface BootstrapPayload {
  user: WebChatUser;
  rooms: WebChatRoom[];
  agents: WebChatAgent[];
}

export interface ThreadMeta {
  id: string;
  title: string;
}

export interface SendMessageResult {
  messageId: string;
  timestamp: number;
}

export interface WebChatAttachment {
  name: string;
  mimeType: string;
  /** `image` for image/* MIME types; `file` for everything else. */
  type: 'image' | 'file';
  size?: number;
  /**
   * Base64 payload (no data: prefix). Required on client sends; present on history/WS
   * today. Adapters may later omit `data` on reads and serve blobs via `url` instead.
   */
  data?: string;
  /** Future: server URL when `data` is omitted from history/WS responses. */
  url?: string;
}

export interface WebChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  timestamp: number;
  platformId: string;
  threadId: string;
  /** Agent display name when provided by the host adapter. */
  senderName?: string;
  attachments?: WebChatAttachment[];
}

export interface WsMessageEvent {
  type: 'message';
  message: WebChatMessage;
}

export interface WsTypingEvent {
  type: 'typing';
  platformId: string;
  threadId: string;
}

export type WsEvent = WsMessageEvent | WsTypingEvent;

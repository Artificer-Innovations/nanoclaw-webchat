export interface WebChatUser {
  id: string;
  displayName: string;
}

export interface WebChatRoom {
  platformId: string;
  name: string;
  kind: 'lobby' | 'dm';
  folder?: string;
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

export interface WebChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  timestamp: number;
  platformId: string;
  threadId: string;
  /** Agent display name when provided by the host adapter. */
  senderName?: string;
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

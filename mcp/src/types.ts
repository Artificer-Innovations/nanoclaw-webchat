export interface WebChatUser {
  id: string;
  displayName: string;
}

export interface ThreadMeta {
  id: string;
  title: string;
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

export interface SendMessageResult {
  messageId: string;
  timestamp: number;
}

export interface WebChatAttachment {
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size?: number;
  data?: string;
  url?: string;
}

export interface WebChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  timestamp: number;
  platformId: string;
  threadId: string;
  senderName?: string;
  attachments?: WebChatAttachment[];
}

export interface ThreadMessagesPayload {
  messages: WebChatMessage[];
  engagedAgents: string[];
}

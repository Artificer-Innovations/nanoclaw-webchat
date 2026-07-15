export interface WebChatUser {
  id: string;
  displayName: string;
}

export interface WebChatRoom {
  platformId: string;
  name: string;
  kind: 'lobby' | 'dm' | 'inbox';
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
  authMode?: 'local' | 'public';
}

export interface AuthConfigResponse {
  basic: { enabled: boolean };
  providers: Array<{ id: string; label: string }>;
}

export interface ThreadMeta {
  id: string;
  title: string;
}

export interface SendMessageResult {
  messageId: string;
  timestamp: number;
  attachments?: WebChatAttachment[];
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
  /** Client upload staging reference (send-only). */
  uploadId?: string;
  /** Client optimistic preview blob URL (display-only). */
  previewUrl?: string;
  /** Client composer mini-preview snippet (display-only; never sent to server). */
  textSnippet?: string;
}

export interface WebChatCardOption {
  label: string;
  selectedLabel?: string;
  value: string;
}

export interface WebChatAskQuestionCard {
  type: 'ask_question';
  questionId: string;
  title: string;
  question: string;
  options: WebChatCardOption[];
  status: 'pending' | 'answered';
  selectedValue?: string;
  selectedLabel?: string;
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
  /** Web user id for inbound messages in shared rooms (public auth). */
  senderId?: string;
  attachments?: WebChatAttachment[];
  /** Interactive ask_question card (approvals, agent questions, etc.). */
  card?: WebChatAskQuestionCard;
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

export interface ThreadMessagesPayload {
  messages: WebChatMessage[];
  engagedAgents: string[];
}

export interface WsEngagedEvent {
  type: 'engaged';
  platformId: string;
  threadId: string;
  agents: string[];
}

export interface WsMessageUpdateEvent {
  type: 'message_update';
  message: WebChatMessage;
}

/** Soft room/agent refresh after sync (e.g. new agent group created). */
export interface WsBootstrapEvent {
  type: 'bootstrap';
  bootstrap: BootstrapPayload;
  /** Public mode: only the owning client should apply this payload. */
  forUserId?: string;
}

export type WsEvent =
  | WsMessageEvent
  | WsTypingEvent
  | WsEngagedEvent
  | WsMessageUpdateEvent
  | WsBootstrapEvent;

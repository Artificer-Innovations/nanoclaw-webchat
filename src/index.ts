import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the built SPA assets (index.html + hashed bundles). */
export function getAssetDir(): string {
  return path.join(__dirname, 'client');
}

export type {
  BootstrapPayload,
  ThreadMeta,
  WebChatAgent,
  WebChatAttachment,
  WebChatMessage,
  WebChatRoom,
  WebChatUser,
  WsEvent,
  WsMessageEvent,
  WsTypingEvent,
} from './types.js';

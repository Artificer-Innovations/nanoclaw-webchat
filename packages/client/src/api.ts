import type {
  BootstrapPayload,
  SendMessageResult,
  ThreadMeta,
  ThreadMessagesPayload,
  WebChatAttachment,
  WebChatMessage,
  WsEvent,
} from './types';

const DEFAULT_WEBCHAT_API_TARGET = 'http://127.0.0.1:3200';

/** Must match the meta tag injected by the web adapter when serving index.html. */
export const WEBCHAT_TOKEN_META_NAME = 'webchat-token';

function tokenFromMeta(): string {
  if (typeof document === 'undefined') return '';
  return document.querySelector(`meta[name="${WEBCHAT_TOKEN_META_NAME}"]`)?.getAttribute('content') ?? '';
}

function tokenFromLocation(): string {
  const fromMeta = tokenFromMeta();
  if (fromMeta) return fromMeta;
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? sessionStorage.getItem('webchat_token') ?? '';
}

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function resolveWebSocketUrl(
  token: string,
  env: Pick<ImportMetaEnv, 'DEV' | 'VITE_WEBCHAT_API_TARGET'> = import.meta.env,
): string {
  if (env.DEV) {
    const target = env.VITE_WEBCHAT_API_TARGET ?? DEFAULT_WEBCHAT_API_TARGET;
    const backend = new URL(target);
    const wsProto = backend.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${backend.host}/api/ws?token=${encodeURIComponent(token)}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;
}

export async function fetchBootstrap(token: string): Promise<BootstrapPayload> {
  const res = await fetch('/api/bootstrap', { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`bootstrap failed: ${res.status}`);
  return res.json() as Promise<BootstrapPayload>;
}

export async function fetchMessages(
  token: string,
  platformId: string,
  threadId: string,
  since = 0,
): Promise<ThreadMessagesPayload> {
  const q = since > 0 ? `?since=${since}` : '';
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages${q}`;
  const res = await fetch(path, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`messages failed: ${res.status}`);
  const data = (await res.json()) as { messages: WebChatMessage[]; engagedAgents?: string[] };
  return {
    messages: data.messages,
    engagedAgents: data.engagedAgents ?? [],
  };
}

export async function sendMessage(
  token: string,
  platformId: string,
  threadId: string,
  text: string,
  attachments?: WebChatAttachment[],
): Promise<SendMessageResult> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages`;
  const body: { text: string; attachments?: WebChatAttachment[] } = { text };
  if (attachments?.length) body.attachments = attachments;
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status}`);
  return res.json() as Promise<SendMessageResult>;
}

export async function createThread(
  token: string,
  platformId: string,
  title: string,
): Promise<ThreadMeta> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads`;
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`create thread failed: ${res.status}`);
  return res.json() as Promise<ThreadMeta>;
}

export async function renameThread(
  token: string,
  platformId: string,
  threadId: string,
  title: string,
): Promise<ThreadMeta> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}`;
  const res = await fetch(path, {
    method: 'PATCH',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`rename thread failed: ${res.status}`);
  return res.json() as Promise<ThreadMeta>;
}

export async function deleteThread(
  token: string,
  platformId: string,
  threadId: string,
): Promise<void> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}`;
  const res = await fetch(path, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`delete thread failed: ${res.status}`);
}

export async function disengageAgent(
  token: string,
  platformId: string,
  threadId: string,
  agentFolder: string,
): Promise<string[]> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/engaged/${encodeURIComponent(agentFolder)}`;
  const res = await fetch(path, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`disengage failed: ${res.status}`);
  const data = (await res.json()) as { agents: string[] };
  return data.agents;
}

export interface WebSocketConnection {
  close: () => void;
}

function closeWebSocket(ws: WebSocket | null): void {
  if (!ws) return;
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.addEventListener('open', () => ws.close(), { once: true });
    return;
  }
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
}

export function connectWebSocket(
  token: string,
  onEvent: (event: WsEvent) => void,
  onOpen?: () => void,
): WebSocketConnection {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;

  const scheduleReconnect = () => {
    if (closed) return;
    const base = Math.min(1000 * 2 ** reconnectAttempt, 30_000);
    const delay = base * (0.5 + Math.random() * 0.5);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    ws = new WebSocket(resolveWebSocketUrl(token));
    ws.onopen = () => {
      reconnectAttempt = 0;
      onOpen?.();
    };
    ws.onmessage = (ev) => {
      try {
        onEvent(JSON.parse(ev.data as string) as WsEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      closeWebSocket(ws);
    };
  };

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeWebSocket(ws);
      ws = null;
    },
  };
}

export function getStoredToken(): string {
  return tokenFromLocation();
}

export function storeToken(token: string): void {
  sessionStorage.setItem('webchat_token', token);
}

/** One-time migration: read legacy browser thread list. */
export function loadLegacyThreads(roomKey: string): ThreadMeta[] {
  try {
    const raw = localStorage.getItem(`webchat_threads:${roomKey}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ThreadMeta[];
    return parsed.filter((t) => t.id !== 'main');
  } catch {
    return [];
  }
}

export function clearLegacyThreads(roomKey: string): void {
  localStorage.removeItem(`webchat_threads:${roomKey}`);
}

/** Remove one migrated thread from legacy storage so partial migration can retry the rest. */
export function removeLegacyThread(roomKey: string, threadId: string): void {
  try {
    const raw = localStorage.getItem(`webchat_threads:${roomKey}`);
    if (!raw) return;
    const parsed = JSON.parse(raw) as ThreadMeta[];
    const next = parsed.filter((t) => t.id !== threadId);
    const withoutMain = next.filter((t) => t.id !== 'main');
    if (withoutMain.length === 0) {
      localStorage.removeItem(`webchat_threads:${roomKey}`);
    } else {
      localStorage.setItem(`webchat_threads:${roomKey}`, JSON.stringify(next));
    }
  } catch {
    // ignore corrupt storage
  }
}

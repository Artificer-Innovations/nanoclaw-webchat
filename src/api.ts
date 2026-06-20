import type { BootstrapPayload, WebChatMessage, WsEvent } from './types';

const DEFAULT_WEBCHAT_API_TARGET = 'http://127.0.0.1:3200';

function tokenFromLocation(): string {
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
): Promise<WebChatMessage[]> {
  const q = since > 0 ? `?since=${since}` : '';
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages${q}`;
  const res = await fetch(path, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`messages failed: ${res.status}`);
  const data = (await res.json()) as { messages: WebChatMessage[] };
  return data.messages;
}

export async function sendMessage(
  token: string,
  platformId: string,
  threadId: string,
  text: string,
): Promise<void> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages`;
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status}`);
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

export function newThreadId(): string {
  return `thread_${crypto.randomUUID()}`;
}

export interface ThreadMeta {
  id: string;
  title: string;
}

export function loadThreads(roomKey: string): ThreadMeta[] {
  try {
    const raw = localStorage.getItem(`webchat_threads:${roomKey}`);
    if (!raw) return [{ id: 'main', title: 'Main' }];
    const parsed = JSON.parse(raw) as ThreadMeta[];
    return parsed.length > 0 ? parsed : [{ id: 'main', title: 'Main' }];
  } catch {
    return [{ id: 'main', title: 'Main' }];
  }
}

export function saveThreads(roomKey: string, threads: ThreadMeta[]): void {
  localStorage.setItem(`webchat_threads:${roomKey}`, JSON.stringify(threads));
}

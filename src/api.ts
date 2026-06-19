import type { BootstrapPayload, WebChatMessage, WsEvent } from './types';

function tokenFromLocation(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('token') ?? sessionStorage.getItem('webchat_token') ?? '';
}

function authHeaders(token: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
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

export function connectWebSocket(token: string, onEvent: (event: WsEvent) => void): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  ws.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data as string) as WsEvent);
    } catch {
      // ignore malformed frames
    }
  };
  return ws;
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

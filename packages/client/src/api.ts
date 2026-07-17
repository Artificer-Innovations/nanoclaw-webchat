import type {
  AgentActivityEvent,
  AuthConfigResponse,
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

export type { AuthConfigResponse };

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

async function apiFetch(path: string, init: RequestInit = {}, token = ''): Promise<Response> {
  const useCookie = !token && !tokenFromMeta();
  return fetch(path, {
    ...init,
    credentials: useCookie ? 'include' : init.credentials,
    headers: {
      ...authHeaders(token),
      ...(init.headers ?? {}),
    },
  });
}

/** True when the page was served with an injected local dev token meta tag. */
export function isLocalTokenMode(): boolean {
  return Boolean(tokenFromMeta());
}

export async function fetchAuthConfig(): Promise<AuthConfigResponse> {
  const res = await fetch('/api/auth/config', { credentials: 'include' });
  if (!res.ok) throw new Error(`auth config failed: ${res.status}`);
  return res.json() as Promise<AuthConfigResponse>;
}

export async function fetchAuthMe(): Promise<{ userId: string; displayName: string } | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`auth me failed: ${res.status}`);
  const data = (await res.json()) as { userId: string; displayName: string };
  return data;
}

/** Whether public auth routes are active on the server. */
export async function detectPublicAuthMode(): Promise<boolean> {
  if (isLocalTokenMode()) return false;
  try {
    await fetchAuthConfig();
    return true;
  } catch {
    return false;
  }
}

const RETURN_TO_STORAGE_KEY = 'webchat_return_to';

export function getReturnToParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('returnTo');
}

/** Accept same-origin absolute URLs or root-relative paths only. */
export function resolveSafeReturnTo(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
    return null;
  }
}

export function redirectToReturnTo(raw: string | null | undefined): boolean {
  const target = resolveSafeReturnTo(raw);
  if (!target) return false;
  window.location.assign(target);
  return true;
}

export function stashReturnToForOidc(): void {
  const returnTo = getReturnToParam();
  if (returnTo) sessionStorage.setItem(RETURN_TO_STORAGE_KEY, returnTo);
}

export function consumeStashedReturnTo(): string | null {
  const value = sessionStorage.getItem(RETURN_TO_STORAGE_KEY);
  if (value) sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
  return value;
}

export async function loginBasic(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login/basic', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error('login failed');
}

export function startOidcLogin(providerId: string): void {
  window.location.href = `/api/auth/login?provider=${encodeURIComponent(providerId)}`;
}

export async function logoutSession(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export function resolveWebSocketUrl(
  token: string,
  env: Pick<ImportMetaEnv, 'DEV' | 'VITE_WEBCHAT_API_TARGET'> = import.meta.env,
): string {
  // Keep the socket under `/api/…`. WEBCHAT_PUBLIC_PATH rewrites only `/api/` and
  // `/assets/` substrings in served JS — a path outside those prefixes would break
  // path-mounted deploys (UI loads, live channel never connects).
  if (env.DEV) {
    const target = env.VITE_WEBCHAT_API_TARGET ?? DEFAULT_WEBCHAT_API_TARGET;
    const backend = new URL(target);
    const wsProto = backend.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!token) return `${wsProto}//${backend.host}/api/ws`;
    return `${wsProto}//${backend.host}/api/ws?token=${encodeURIComponent(token)}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (!token) return `${proto}//${window.location.host}/api/ws`;
  return `${proto}//${window.location.host}/api/ws?token=${encodeURIComponent(token)}`;
}

export async function fetchBootstrap(token: string): Promise<BootstrapPayload> {
  const res = await apiFetch('/api/bootstrap', {}, token);
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
  const res = await apiFetch(path, {}, token);
  if (!res.ok) throw new Error(`messages failed: ${res.status}`);
  const data = (await res.json()) as { messages: WebChatMessage[]; engagedAgents?: string[] };
  return {
    messages: data.messages,
    engagedAgents: data.engagedAgents ?? [],
  };
}

export async function fetchActivity(
  token: string,
  platformId: string,
  threadId: string,
): Promise<AgentActivityEvent[]> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/activity`;
  const res = await apiFetch(path, {}, token);
  if (!res.ok) throw new Error(`activity failed: ${res.status}`);
  const data = (await res.json()) as { events?: AgentActivityEvent[] };
  return data.events ?? [];
}

export interface UploadAttachmentResult {
  uploadId: string;
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size: number;
}

export async function uploadAttachmentMultipart(
  token: string,
  platformId: string,
  threadId: string,
  file: File,
): Promise<UploadAttachmentResult> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/uploads`;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(path, {
    method: 'POST',
    headers: authHeaders(token),
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `upload failed: ${res.status}`);
  }
  return res.json() as Promise<UploadAttachmentResult>;
}

export async function uploadAttachmentChunk(
  token: string,
  platformId: string,
  threadId: string,
  body: {
    uploadId: string;
    chunkIndex: number;
    totalChunks: number;
    filename: string;
    mimeType: string;
    data: string;
  },
): Promise<UploadAttachmentResult | { ok: true; received: number; total: number }> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/uploads/chunk`;
  const res = await fetch(path, {
    method: 'POST',
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `upload failed: ${res.status}`);
  }
  return res.json() as Promise<UploadAttachmentResult | { ok: true; received: number; total: number }>;
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
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, token);
  if (!res.ok) throw new Error(`send failed: ${res.status}`);
  return res.json() as Promise<SendMessageResult>;
}

export async function createThread(
  token: string,
  platformId: string,
  title: string,
): Promise<ThreadMeta> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads`;
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }, token);
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
  const res = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }, token);
  if (!res.ok) throw new Error(`rename thread failed: ${res.status}`);
  return res.json() as Promise<ThreadMeta>;
}

export async function deleteThread(
  token: string,
  platformId: string,
  threadId: string,
): Promise<void> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}`;
  const res = await apiFetch(path, { method: 'DELETE' }, token);
  if (!res.ok) throw new Error(`delete thread failed: ${res.status}`);
}

export async function submitAction(
  token: string,
  platformId: string,
  threadId: string,
  questionId: string,
  value: string,
): Promise<void> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/actions`;
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionId, value }),
  }, token);
  if (!res.ok) throw new Error(`action failed: ${res.status}`);
}

export async function disengageAgent(
  token: string,
  platformId: string,
  threadId: string,
  agentFolder: string,
): Promise<string[]> {
  const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/engaged/${encodeURIComponent(agentFolder)}`;
  const res = await apiFetch(path, { method: 'DELETE' }, token);
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

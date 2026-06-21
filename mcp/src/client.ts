import type {
  BootstrapPayload,
  SendMessageResult,
  ThreadMeta,
  ThreadMessagesPayload,
  WebChatAttachment,
} from './types.js';

export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface WebchatClientOptions {
  apiBase: string;
  secret: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    return (await res.text()).trim();
  } catch {
    return '';
  }
}

function httpError(operation: string, status: number, detail: string): Error {
  return new Error(`${operation} failed: ${status}${detail ? ` — ${detail}` : ''}`);
}

export class WebchatClient {
  private readonly apiBase: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WebchatClientOptions) {
    this.apiBase = options.apiBase.replace(/\/$/, '');
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private url(path: string): string {
    return `${this.apiBase}${path}`;
  }

  private async fetchWithTimeout(label: string, url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`${label} request timed out after ${this.timeoutMs / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async request(
    label: string,
    path: string,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    const res = await this.fetchWithTimeout(label, this.url(path), init);
    if (!res.ok) {
      const detail = await readErrorDetail(res);
      throw httpError(operation, res.status, detail);
    }
    return res;
  }

  async fetchBootstrap(): Promise<BootstrapPayload> {
    const res = await this.request(
      'bootstrap',
      '/api/bootstrap',
      { headers: authHeaders(this.secret) },
      'bootstrap',
    );
    return res.json() as Promise<BootstrapPayload>;
  }

  async fetchMessages(
    platformId: string,
    threadId: string,
    since = 0,
  ): Promise<ThreadMessagesPayload> {
    const q = since > 0 ? `?since=${since}` : '';
    const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages${q}`;
    const res = await this.request(
      `messages/${platformId}/${threadId}`,
      path,
      { headers: authHeaders(this.secret) },
      'messages',
    );
    const data = (await res.json()) as { messages: ThreadMessagesPayload['messages']; engagedAgents?: string[] };
    return {
      messages: data.messages,
      engagedAgents: data.engagedAgents ?? [],
    };
  }

  async sendMessage(
    platformId: string,
    threadId: string,
    text: string,
    attachments?: WebChatAttachment[],
  ): Promise<SendMessageResult> {
    const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages`;
    const body: { text: string; attachments?: WebChatAttachment[] } = { text };
    if (attachments?.length) body.attachments = attachments;
    const res = await this.request(
      `send/${platformId}/${threadId}`,
      path,
      {
        method: 'POST',
        headers: { ...authHeaders(this.secret), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      'send',
    );
    return res.json() as Promise<SendMessageResult>;
  }

  async createThread(platformId: string, title?: string): Promise<ThreadMeta> {
    const path = `/api/rooms/${encodeURIComponent(platformId)}/threads`;
    const res = await this.request(
      `create-thread/${platformId}`,
      path,
      {
        method: 'POST',
        headers: { ...authHeaders(this.secret), 'Content-Type': 'application/json' },
        body: JSON.stringify(title ? { title } : {}),
      },
      'create thread',
    );
    return res.json() as Promise<ThreadMeta>;
  }
}

export type { SendMessageResult };

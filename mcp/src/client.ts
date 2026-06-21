import type {
  BootstrapPayload,
  SendMessageResult,
  ThreadMeta,
  ThreadMessagesPayload,
  WebChatAttachment,
} from './types.js';

export interface WebchatClientOptions {
  apiBase: string;
  secret: string;
  fetchImpl?: typeof fetch;
}

function authHeaders(secret: string): Record<string, string> {
  return { Authorization: `Bearer ${secret}` };
}

export class WebchatClient {
  private readonly apiBase: string;
  private readonly secret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: WebchatClientOptions) {
    this.apiBase = options.apiBase.replace(/\/$/, '');
    this.secret = options.secret;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private url(path: string): string {
    return `${this.apiBase}${path}`;
  }

  async fetchBootstrap(): Promise<BootstrapPayload> {
    const res = await this.fetchImpl(this.url('/api/bootstrap'), {
      headers: authHeaders(this.secret),
    });
    if (!res.ok) {
      throw new Error(`bootstrap failed: ${res.status}`);
    }
    return res.json() as Promise<BootstrapPayload>;
  }

  async fetchMessages(
    platformId: string,
    threadId: string,
    since = 0,
  ): Promise<ThreadMessagesPayload> {
    const q = since > 0 ? `?since=${since}` : '';
    const path = `/api/rooms/${encodeURIComponent(platformId)}/threads/${encodeURIComponent(threadId)}/messages${q}`;
    const res = await this.fetchImpl(this.url(path), {
      headers: authHeaders(this.secret),
    });
    if (!res.ok) {
      throw new Error(`messages failed: ${res.status}`);
    }
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
    const res = await this.fetchImpl(this.url(path), {
      method: 'POST',
      headers: { ...authHeaders(this.secret), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`send failed: ${res.status}`);
    }
    return res.json() as Promise<SendMessageResult>;
  }

  async createThread(platformId: string, title?: string): Promise<ThreadMeta> {
    const path = `/api/rooms/${encodeURIComponent(platformId)}/threads`;
    const res = await this.fetchImpl(this.url(path), {
      method: 'POST',
      headers: { ...authHeaders(this.secret), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title ?? '' }),
    });
    if (!res.ok) {
      throw new Error(`create thread failed: ${res.status}`);
    }
    return res.json() as Promise<ThreadMeta>;
  }
}

export type { SendMessageResult };

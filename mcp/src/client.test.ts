import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebchatClient, DEFAULT_REQUEST_TIMEOUT_MS } from './client.js';
import type { BootstrapPayload, WebChatMessage } from './types.js';

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'web:local', displayName: 'Local' },
  rooms: [
    {
      platformId: 'lobby',
      name: 'Lobby',
      kind: 'lobby',
      threads: [{ id: 'main', title: 'Main' }],
    },
  ],
  agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
};

const messageFixture: WebChatMessage = {
  id: 'web-1',
  direction: 'outbound',
  text: 'Hello',
  timestamp: 1710000000000,
  platformId: 'lobby',
  threadId: 'main',
  senderName: 'Sarah',
};

function mockOkResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function mockErrorResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    text: async () => body,
  } as Response;
}

describe('WebchatClient', () => {
  let client: WebchatClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    client = new WebchatClient({
      apiBase: 'http://127.0.0.1:3200',
      secret: 'secret',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('fetchBootstrap sends auth header and abort signal', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(bootstrapFixture));

    const result = await client.fetchBootstrap();

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/bootstrap',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret' },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(result).toEqual(bootstrapFixture);
  });

  it('fetchBootstrap includes error body in thrown message', async () => {
    vi.mocked(fetch).mockResolvedValue(mockErrorResponse(401, '{"error":"invalid token"}'));
    await expect(client.fetchBootstrap()).rejects.toThrow(
      'bootstrap failed: 401 — {"error":"invalid token"}',
    );
  });

  it('fetchBootstrap throws when error body read fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => {
        throw new Error('read failed');
      },
    } as Response);
    await expect(client.fetchBootstrap()).rejects.toThrow('bootstrap failed: 403');
  });

  it('fetchMessages builds URL with encoding and since', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockOkResponse({ messages: [messageFixture], engagedAgents: ['sarah'] }),
    );

    const result = await client.fetchMessages('dm:sarah', 'thread_abc', 1000);

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/rooms/dm%3Asarah/threads/thread_abc/messages?since=1000',
      expect.objectContaining({ headers: { Authorization: 'Bearer secret' } }),
    );
    expect(result).toEqual({ messages: [messageFixture], engagedAgents: ['sarah'] });
  });

  it('fetchMessages defaults engagedAgents to empty array', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ messages: [] }));
    const result = await client.fetchMessages('lobby', 'main');
    expect(result.engagedAgents).toEqual([]);
  });

  it('fetchMessages throws on error status with body', async () => {
    vi.mocked(fetch).mockResolvedValue(mockErrorResponse(404, 'not found'));
    await expect(client.fetchMessages('lobby', 'main')).rejects.toThrow('messages failed: 404 — not found');
  });

  it('sendMessage posts JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockOkResponse({ messageId: 'web-123', timestamp: 1710000000001 }),
    );

    const result = await client.sendMessage('lobby', 'main', 'Hi', [
      { name: 'a.png', mimeType: 'image/png', type: 'image', data: 'abc' },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/rooms/lobby/threads/main/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: 'Hi',
          attachments: [{ name: 'a.png', mimeType: 'image/png', type: 'image', data: 'abc' }],
        }),
      }),
    );
    expect(result).toEqual({ messageId: 'web-123', timestamp: 1710000000001 });
  });

  it('sendMessage throws on error status', async () => {
    vi.mocked(fetch).mockResolvedValue(mockErrorResponse(500, 'server error'));
    await expect(client.sendMessage('lobby', 'main', 'Hi')).rejects.toThrow('send failed: 500 — server error');
  });

  it('createThread posts title when provided', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ id: 'thread_abc', title: 'Review' }));

    const result = await client.createThread('lobby', 'Review');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/rooms/lobby/threads',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Review' }),
      }),
    );
    expect(result).toEqual({ id: 'thread_abc', title: 'Review' });
  });

  it('createThread omits title field when not provided', async () => {
    vi.mocked(fetch).mockResolvedValue(mockOkResponse({ id: 'thread_abc', title: 'Thread 1' }));

    await client.createThread('lobby');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/rooms/lobby/threads',
      expect.objectContaining({
        body: JSON.stringify({}),
      }),
    );
  });

  it('createThread throws on error status', async () => {
    vi.mocked(fetch).mockResolvedValue(mockErrorResponse(400, 'bad request'));
    await expect(client.createThread('lobby')).rejects.toThrow('create thread failed: 400 — bad request');
  });

  it('fetchBootstrap times out with labeled error', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    );

    const promise = client.fetchBootstrap().catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(DEFAULT_REQUEST_TIMEOUT_MS);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('bootstrap request timed out after 30s');
  });

  it('fetchBootstrap clears timeout timer on success', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(bootstrapFixture));

    await expect(client.fetchBootstrap()).resolves.toEqual(bootstrapFixture);
    await vi.runAllTimersAsync();
  });

  it('rethrows non-abort fetch errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));
    await expect(client.fetchBootstrap()).rejects.toThrow('network down');
  });

  it('strips trailing slash from apiBase', async () => {
    const trimmed = new WebchatClient({
      apiBase: 'http://127.0.0.1:3200/',
      secret: 'secret',
    });
    vi.mocked(fetch).mockResolvedValue(mockOkResponse(bootstrapFixture));
    await trimmed.fetchBootstrap();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3200/api/bootstrap', expect.any(Object));
  });

  it('uses custom timeoutMs', async () => {
    vi.useFakeTimers();
    const fastClient = new WebchatClient({
      apiBase: 'http://127.0.0.1:3200',
      secret: 'secret',
      timeoutMs: 5_000,
    });
    vi.mocked(fetch).mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    );

    const promise = fastClient.fetchMessages('lobby', 'main').catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(5_000);
    const err = await promise;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('messages/lobby/main request timed out after 5s');
  });
});

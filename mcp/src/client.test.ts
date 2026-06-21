import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebchatClient } from './client.js';
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
    vi.unstubAllGlobals();
  });

  it('fetchBootstrap sends auth header', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => bootstrapFixture,
    } as Response);

    const result = await client.fetchBootstrap();

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3200/api/bootstrap', {
      headers: { Authorization: 'Bearer secret' },
    });
    expect(result).toEqual(bootstrapFixture);
  });

  it('fetchBootstrap throws on error status', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(client.fetchBootstrap()).rejects.toThrow('bootstrap failed: 401');
  });

  it('fetchMessages builds URL with encoding and since', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [messageFixture], engagedAgents: ['sarah'] }),
    } as Response);

    const result = await client.fetchMessages('dm:sarah', 'thread_abc', 1000);

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/rooms/dm%3Asarah/threads/thread_abc/messages?since=1000',
      { headers: { Authorization: 'Bearer secret' } },
    );
    expect(result).toEqual({ messages: [messageFixture], engagedAgents: ['sarah'] });
  });

  it('fetchMessages defaults engagedAgents to empty array', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [] }),
    } as Response);
    const result = await client.fetchMessages('lobby', 'main');
    expect(result.engagedAgents).toEqual([]);
  });

  it('fetchMessages throws on error status', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(client.fetchMessages('lobby', 'main')).rejects.toThrow('messages failed: 404');
  });

  it('sendMessage posts JSON body', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: 'web-123', timestamp: 1710000000001 }),
    } as Response);

    const result = await client.sendMessage('lobby', 'main', 'Hi', [
      { name: 'a.png', mimeType: 'image/png', type: 'image', data: 'abc' },
    ]);

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3200/api/rooms/lobby/threads/main/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: 'Hi',
          attachments: [{ name: 'a.png', mimeType: 'image/png', type: 'image', data: 'abc' }],
        }),
      }),
    );
    expect(result).toEqual({ messageId: 'web-123', timestamp: 1710000000001 });
  });

  it('sendMessage throws on error status', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(client.sendMessage('lobby', 'main', 'Hi')).rejects.toThrow('send failed: 500');
  });

  it('createThread posts title', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'thread_abc', title: 'Review' }),
    } as Response);

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

  it('createThread throws on error status', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400 } as Response);
    await expect(client.createThread('lobby')).rejects.toThrow('create thread failed: 400');
  });

  it('strips trailing slash from apiBase', async () => {
    const trimmed = new WebchatClient({
      apiBase: 'http://127.0.0.1:3200/',
      secret: 'secret',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => bootstrapFixture,
    } as Response);
    await trimmed.fetchBootstrap();
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3200/api/bootstrap', expect.any(Object));
  });
});

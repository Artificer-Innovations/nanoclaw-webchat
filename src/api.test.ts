import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectWebSocket,
  fetchBootstrap,
  fetchMessages,
  getStoredToken,
  loadThreads,
  newThreadId,
  saveThreads,
  sendMessage,
  storeToken,
} from './api';
import type { BootstrapPayload, WebChatMessage, WsEvent } from './types';

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'u1', displayName: 'Test User' },
  rooms: [
    { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' },
    { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah' },
  ],
  agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
};

const messageFixture: WebChatMessage = {
  id: 'msg-1',
  direction: 'outbound',
  text: 'Hello',
  timestamp: 1_700_000_000_000,
  platformId: 'lobby-1',
  threadId: 'main',
};

describe('api', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:3200',
      search: '',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('getStoredToken', () => {
    it('reads token from URL search params', () => {
      vi.stubGlobal('location', {
        protocol: 'http:',
        host: 'localhost:3200',
        search: '?token=url-token',
      });
      expect(getStoredToken()).toBe('url-token');
    });

    it('falls back to sessionStorage when URL has no token', () => {
      sessionStorage.setItem('webchat_token', 'stored-token');
      expect(getStoredToken()).toBe('stored-token');
    });

    it('returns empty string when no token is available', () => {
      expect(getStoredToken()).toBe('');
    });
  });

  describe('storeToken', () => {
    it('persists token in sessionStorage', () => {
      storeToken('my-token');
      expect(sessionStorage.getItem('webchat_token')).toBe('my-token');
    });
  });

  describe('fetchBootstrap', () => {
    it('fetches bootstrap data with auth header when token is provided', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => bootstrapFixture,
      } as Response);

      const result = await fetchBootstrap('secret');

      expect(fetch).toHaveBeenCalledWith('/api/bootstrap', {
        headers: { Authorization: 'Bearer secret' },
      });
      expect(result).toEqual(bootstrapFixture);
    });

    it('fetches bootstrap without auth header when token is empty', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => bootstrapFixture,
      } as Response);

      await fetchBootstrap('');

      expect(fetch).toHaveBeenCalledWith('/api/bootstrap', { headers: {} });
    });

    it('throws when bootstrap request fails', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

      await expect(fetchBootstrap('bad')).rejects.toThrow('bootstrap failed: 401');
    });
  });

  describe('fetchMessages', () => {
    it('fetches messages without since query by default', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [messageFixture] }),
      } as Response);

      const messages = await fetchMessages('secret', 'lobby-1', 'main');

      expect(fetch).toHaveBeenCalledWith(
        '/api/rooms/lobby-1/threads/main/messages',
        { headers: { Authorization: 'Bearer secret' } },
      );
      expect(messages).toEqual([messageFixture]);
    });

    it('includes since query when since is greater than zero', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
      } as Response);

      await fetchMessages('secret', 'room/id', 'thread/id', 42);

      expect(fetch).toHaveBeenCalledWith(
        '/api/rooms/room%2Fid/threads/thread%2Fid/messages?since=42',
        { headers: { Authorization: 'Bearer secret' } },
      );
    });

    it('throws when messages request fails', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

      await expect(fetchMessages('', 'lobby-1', 'main')).rejects.toThrow('messages failed: 500');
    });
  });

  describe('sendMessage', () => {
    it('posts message payload with JSON content type', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

      await sendMessage('secret', 'lobby-1', 'main', 'hello');

      expect(fetch).toHaveBeenCalledWith('/api/rooms/lobby-1/threads/main/messages', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello' }),
      });
    });

    it('throws when send request fails', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);

      await expect(sendMessage('secret', 'lobby-1', 'main', 'hello')).rejects.toThrow(
        'send failed: 403',
      );
    });
  });

  describe('connectWebSocket', () => {
    it('connects over ws and forwards parsed events', () => {
      const WebSocketMock = vi.fn(function WebSocket(this: {
        url: string;
        onmessage: ((ev: MessageEvent) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }, url: string) {
        this.url = url;
        this.onmessage = null;
        this.close = vi.fn();
      });
      vi.stubGlobal('WebSocket', WebSocketMock);
      const onEvent = vi.fn<(event: WsEvent) => void>();

      const ws = connectWebSocket('tok/en', onEvent);

      expect(WebSocketMock).toHaveBeenCalledWith('ws://localhost:3200/api/ws?token=tok%2Fen');
      ws.onmessage?.({ data: JSON.stringify({ type: 'typing', platformId: 'p', threadId: 't' }) } as MessageEvent);
      expect(onEvent).toHaveBeenCalledWith({ type: 'typing', platformId: 'p', threadId: 't' });
    });

    it('uses wss when page is served over https', () => {
      vi.stubGlobal('location', {
        protocol: 'https:',
        host: 'example.com',
        search: '',
      });
      const WebSocketMock = vi.fn(function WebSocket(this: {
        onmessage: null;
        close: ReturnType<typeof vi.fn>;
      }) {
        this.onmessage = null;
        this.close = vi.fn();
      });
      vi.stubGlobal('WebSocket', WebSocketMock);

      connectWebSocket('token', vi.fn());

      expect(WebSocketMock).toHaveBeenCalledWith('wss://example.com/api/ws?token=token');
    });

    it('ignores malformed websocket frames', () => {
      const WebSocketMock = vi.fn(function WebSocket(this: {
        onmessage: ((ev: MessageEvent) => void) | null;
        close: ReturnType<typeof vi.fn>;
      }) {
        this.onmessage = null;
        this.close = vi.fn();
      });
      vi.stubGlobal('WebSocket', WebSocketMock);
      const onEvent = vi.fn();

      const ws = connectWebSocket('token', onEvent);
      ws.onmessage?.({ data: 'not-json' } as MessageEvent);

      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe('newThreadId', () => {
    it('returns a thread id prefixed with thread_', () => {
      vi.stubGlobal('crypto', { randomUUID: () => 'abc-123' });
      expect(newThreadId()).toBe('thread_abc-123');
    });
  });

  describe('loadThreads', () => {
    it('returns default main thread when storage is empty', () => {
      expect(loadThreads('lobby-1')).toEqual([{ id: 'main', title: 'Main' }]);
    });

    it('returns stored threads when valid data exists', () => {
      localStorage.setItem(
        'webchat_threads:lobby-1',
        JSON.stringify([
          { id: 'main', title: 'Main' },
          { id: 'thread_1', title: 'Thread 1' },
        ]),
      );

      expect(loadThreads('lobby-1')).toEqual([
        { id: 'main', title: 'Main' },
        { id: 'thread_1', title: 'Thread 1' },
      ]);
    });

    it('returns default main thread when stored list is empty', () => {
      localStorage.setItem('webchat_threads:lobby-1', JSON.stringify([]));
      expect(loadThreads('lobby-1')).toEqual([{ id: 'main', title: 'Main' }]);
    });

    it('returns default main thread when stored JSON is invalid', () => {
      localStorage.setItem('webchat_threads:lobby-1', '{bad json');
      expect(loadThreads('lobby-1')).toEqual([{ id: 'main', title: 'Main' }]);
    });
  });

  describe('saveThreads', () => {
    it('persists threads for a room key', () => {
      const threads = [
        { id: 'main', title: 'Main' },
        { id: 'thread_2', title: 'Thread 2' },
      ];
      saveThreads('lobby-1', threads);
      expect(localStorage.getItem('webchat_threads:lobby-1')).toBe(JSON.stringify(threads));
    });
  });
});

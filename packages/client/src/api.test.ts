import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLegacyThreads,
  connectWebSocket,
  createThread,
  deleteThread,
  disengageAgent,
  fetchBootstrap,
  fetchMessages,
  getStoredToken,
  loadLegacyThreads,
  removeLegacyThread,
  renameThread,
  resolveWebSocketUrl,
  sendMessage,
  storeToken,
} from './api';
import type { BootstrapPayload, WebChatMessage, WsEvent } from './types';

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'u1', displayName: 'Test User' },
  rooms: [
    { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby', threads: [{ id: 'main', title: 'Main' }] },
    { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah', threads: [{ id: 'main', title: 'Main' }] },
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
    document.head.querySelectorAll('meta[name="webchat-token"]').forEach((node) => node.remove());
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
    it('reads token from injected meta tag', () => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'webchat-token');
      meta.setAttribute('content', 'meta-token');
      document.head.appendChild(meta);
      expect(getStoredToken()).toBe('meta-token');
    });

    it('prefers meta tag over URL search params and sessionStorage', () => {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'webchat-token');
      meta.setAttribute('content', 'meta-token');
      document.head.appendChild(meta);
      vi.stubGlobal('location', {
        protocol: 'http:',
        host: 'localhost:3200',
        search: '?token=url-token',
      });
      sessionStorage.setItem('webchat_token', 'stored-token');
      expect(getStoredToken()).toBe('meta-token');
    });

    it('reads token from URL search params when meta is absent', () => {
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

    it('returns empty string when document is unavailable', () => {
      vi.stubGlobal('document', undefined);
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
      expect(messages).toEqual({ messages: [messageFixture], engagedAgents: [] });
    });

    it('defaults engagedAgents when omitted from response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [] }),
      } as Response);

      const result = await fetchMessages('secret', 'lobby-1', 'main');
      expect(result.engagedAgents).toEqual([]);
    });

    it('parses engagedAgents from response', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [], engagedAgents: ['sarah', 'diego'] }),
      } as Response);

      const result = await fetchMessages('secret', 'lobby-1', 'main');
      expect(result.engagedAgents).toEqual(['sarah', 'diego']);
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
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ messageId: 'web-123', timestamp: 1_700_000_000_000 }),
      } as Response);

      const result = await sendMessage('secret', 'lobby-1', 'main', 'hello');

      expect(result).toEqual({ messageId: 'web-123', timestamp: 1_700_000_000_000 });

      expect(fetch).toHaveBeenCalledWith('/api/rooms/lobby-1/threads/main/messages', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello' }),
      });
    });

    it('includes attachments in the POST body when provided', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ messageId: 'web-123', timestamp: 1_700_000_000_000 }),
      } as Response);
      const attachments = [
        {
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image' as const,
          data: 'abc',
        },
      ];

      await sendMessage('secret', 'lobby-1', 'main', '', attachments);

      expect(fetch).toHaveBeenCalledWith('/api/rooms/lobby-1/threads/main/messages', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '', attachments }),
      });
    });

    it('throws when send request fails', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false, status: 403 } as Response);

      await expect(sendMessage('secret', 'lobby-1', 'main', 'hello')).rejects.toThrow(
        'send failed: 403',
      );
    });
  });

  describe('resolveWebSocketUrl', () => {
    it('uses the dev backend host instead of the Vite dev-server proxy', () => {
      vi.stubEnv('VITE_WEBCHAT_API_TARGET', 'http://127.0.0.1:3200');
      expect(resolveWebSocketUrl('tok/en')).toBe('ws://127.0.0.1:3200/api/ws?token=tok%2Fen');
    });

    it('uses wss for https dev backend targets', () => {
      vi.stubEnv('VITE_WEBCHAT_API_TARGET', 'https://127.0.0.1:3200');
      expect(resolveWebSocketUrl('token')).toBe('wss://127.0.0.1:3200/api/ws?token=token');
    });

    it('uses the page host when built for production', () => {
      vi.stubGlobal('location', {
        protocol: 'https:',
        host: 'chat.example.com',
        search: '',
      });
      expect(resolveWebSocketUrl('token', { DEV: false, VITE_WEBCHAT_API_TARGET: undefined })).toBe(
        'wss://chat.example.com/api/ws?token=token',
      );
    });

    it('uses ws for plain http production pages', () => {
      vi.stubGlobal('location', {
        protocol: 'http:',
        host: 'chat.example.com',
        search: '',
      });
      expect(resolveWebSocketUrl('token', { DEV: false, VITE_WEBCHAT_API_TARGET: undefined })).toBe(
        'ws://chat.example.com/api/ws?token=token',
      );
    });
  });

  describe('connectWebSocket', () => {
    it('connects over ws and forwards parsed events', () => {
      type MockSocket = {
        url: string;
        onopen: (() => void) | null;
        onmessage: ((ev: MessageEvent) => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket, url: string) {
        this.url = url;
        this.onopen = null;
        this.onmessage = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);
      vi.stubEnv('VITE_WEBCHAT_API_TARGET', 'http://127.0.0.1:3200');
      const onEvent = vi.fn<(event: WsEvent) => void>();

      connectWebSocket('tok/en', onEvent);

      expect(WebSocketMock).toHaveBeenCalledWith('ws://127.0.0.1:3200/api/ws?token=tok%2Fen');
      instances[0]?.onopen?.();
      instances[0]?.onmessage?.({
        data: JSON.stringify({ type: 'typing', platformId: 'p', threadId: 't' }),
      } as MessageEvent);
      expect(onEvent).toHaveBeenCalledWith({ type: 'typing', platformId: 'p', threadId: 't' });
    });

    it('calls onOpen when the socket connects', () => {
      type MockSocket = {
        onopen: (() => void) | null;
        readyState: number;
        close: ReturnType<typeof vi.fn>;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onopen = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);
      const onOpen = vi.fn();

      connectWebSocket('token', vi.fn(), onOpen);
      instances[0]?.onopen?.();

      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('ignores malformed websocket frames', () => {
      type MockSocket = {
        onmessage: ((ev: MessageEvent) => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onmessage = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);
      const onEvent = vi.fn();

      connectWebSocket('token', onEvent);
      instances[0]?.onmessage?.({ data: 'not-json' } as MessageEvent);

      expect(onEvent).not.toHaveBeenCalled();
    });

    it('reconnects after an unexpected close', () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(1);
      type MockSocket = {
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onopen = null;
        this.onclose = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      connectWebSocket('token', vi.fn());
      instances[0]?.onclose?.();
      vi.advanceTimersByTime(1000);

      expect(WebSocketMock).toHaveBeenCalledTimes(2);
      vi.mocked(Math.random).mockRestore();
      vi.useRealTimers();
    });

    it('applies full-jitter to reconnect backoff', () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(0);
      type MockSocket = {
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onopen = null;
        this.onclose = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      connectWebSocket('token', vi.fn());
      instances[0]?.onclose?.();
      vi.advanceTimersByTime(500);

      expect(WebSocketMock).toHaveBeenCalledTimes(2);
      vi.mocked(Math.random).mockRestore();
      vi.useRealTimers();
    });

    it('resets reconnect backoff after the socket opens', () => {
      vi.useFakeTimers();
      vi.spyOn(Math, 'random').mockReturnValue(1);
      type MockSocket = {
        onopen: (() => void) | null;
        onclose: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onopen = null;
        this.onclose = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      connectWebSocket('token', vi.fn());
      instances[0]?.onopen?.();
      instances[0]?.onclose?.();
      vi.advanceTimersByTime(1000);

      expect(WebSocketMock).toHaveBeenCalledTimes(2);
      vi.mocked(Math.random).mockRestore();
      vi.useRealTimers();
    });

    it('defers close until connect completes when shutting down early', () => {
      let openHandler: (() => void) | undefined;
      type MockSocket = {
        readyState: number;
        addEventListener: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.readyState = 0;
        this.addEventListener = vi.fn((_event, handler) => {
          openHandler = handler as () => void;
        });
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      const connection = connectWebSocket('token', vi.fn());
      connection.close();
      openHandler?.();

      expect(instances[0]?.addEventListener).toHaveBeenCalledWith('open', expect.any(Function), {
        once: true,
      });
      expect(instances[0]?.close).toHaveBeenCalled();
    });

    it('closes open sockets on error', () => {
      type MockSocket = {
        onerror: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onerror = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      connectWebSocket('token', vi.fn());
      instances[0]?.onerror?.();

      expect(instances[0]?.close).toHaveBeenCalled();
    });

    it('stops reconnecting after close is called', () => {
      vi.useFakeTimers();
      type MockSocket = {
        onclose: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onclose = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      const connection = connectWebSocket('token', vi.fn());
      connection.close();
      instances[0]?.onclose?.();
      vi.advanceTimersByTime(30_000);

      expect(WebSocketMock).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('cancels a pending reconnect when close is called', () => {
      vi.useFakeTimers();
      type MockSocket = {
        onclose: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onclose = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      const connection = connectWebSocket('token', vi.fn());
      instances[0]?.onclose?.();
      connection.close();
      vi.advanceTimersByTime(30_000);

      expect(WebSocketMock).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('ignores reconnect timers after the connection has been closed', () => {
      vi.useFakeTimers();
      type MockSocket = {
        onclose: (() => void) | null;
        close: ReturnType<typeof vi.fn>;
        readyState: number;
      };
      const instances: MockSocket[] = [];
      const WebSocketMock = vi.fn(function WebSocket(this: MockSocket) {
        this.onclose = null;
        this.readyState = 1;
        this.close = vi.fn();
        instances.push(this);
      });
      WebSocketMock.CONNECTING = 0;
      WebSocketMock.OPEN = 1;
      vi.stubGlobal('WebSocket', WebSocketMock);

      const connection = connectWebSocket('token', vi.fn());
      instances[0]?.onclose?.();
      vi.advanceTimersByTime(1000);
      connection.close();
      instances[1]?.onclose?.();
      vi.advanceTimersByTime(30_000);

      expect(WebSocketMock).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('loadLegacyThreads', () => {
    it('returns empty list when storage is empty', () => {
      expect(loadLegacyThreads('lobby-1')).toEqual([]);
    });

    it('returns non-main threads from storage', () => {
      localStorage.setItem(
        'webchat_threads:lobby-1',
        JSON.stringify([
          { id: 'main', title: 'Main' },
          { id: 'thread_1', title: 'Thread 1' },
        ]),
      );

      expect(loadLegacyThreads('lobby-1')).toEqual([{ id: 'thread_1', title: 'Thread 1' }]);
    });

    it('returns empty list when stored JSON is invalid', () => {
      localStorage.setItem('webchat_threads:lobby-1', '{bad json');
      expect(loadLegacyThreads('lobby-1')).toEqual([]);
    });
  });

  describe('clearLegacyThreads', () => {
    it('removes legacy storage key', () => {
      localStorage.setItem('webchat_threads:lobby-1', '[]');
      clearLegacyThreads('lobby-1');
      expect(localStorage.getItem('webchat_threads:lobby-1')).toBeNull();
    });
  });

  describe('removeLegacyThread', () => {
    it('removes one thread and clears storage when only main remains', () => {
      localStorage.setItem(
        'webchat_threads:lobby-1',
        JSON.stringify([
          { id: 'main', title: 'Main' },
          { id: 'thread_1', title: 'One' },
        ]),
      );
      removeLegacyThread('lobby-1', 'thread_1');
      expect(localStorage.getItem('webchat_threads:lobby-1')).toBeNull();
    });

    it('keeps remaining threads in storage', () => {
      localStorage.setItem(
        'webchat_threads:lobby-1',
        JSON.stringify([
          { id: 'thread_1', title: 'One' },
          { id: 'thread_2', title: 'Two' },
        ]),
      );
      removeLegacyThread('lobby-1', 'thread_1');
      expect(JSON.parse(localStorage.getItem('webchat_threads:lobby-1')!)).toEqual([
        { id: 'thread_2', title: 'Two' },
      ]);
    });

    it('ignores corrupt legacy storage', () => {
      localStorage.setItem('webchat_threads:lobby-1', '{bad json');
      removeLegacyThread('lobby-1', 'thread_1');
      expect(localStorage.getItem('webchat_threads:lobby-1')).toBe('{bad json');
    });

    it('is a no-op when legacy storage is missing', () => {
      removeLegacyThread('lobby-1', 'thread_1');
      expect(localStorage.getItem('webchat_threads:lobby-1')).toBeNull();
    });
  });

  describe('createThread', () => {
    it('POSTs thread title to the server', async () => {
      const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
        expect(input).toBe('/api/rooms/lobby-1/threads');
        expect(init?.method).toBe('POST');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'thread_abc', title: 'Topic' }),
        } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const thread = await createThread('token', 'lobby-1', 'Topic');
      expect(thread).toEqual({ id: 'thread_abc', title: 'Topic' });
    });

    it('throws when the server rejects the request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 500, json: async () => null }) as Response),
      );
      await expect(createThread('token', 'lobby-1', 'Topic')).rejects.toThrow('create thread failed: 500');
    });
  });

  describe('renameThread', () => {
    it('PATCHes thread title to the server', async () => {
      const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
        expect(input).toBe('/api/rooms/lobby-1/threads/thread_b');
        expect(init?.method).toBe('PATCH');
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'thread_b', title: 'Renamed' }),
        } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      const thread = await renameThread('token', 'lobby-1', 'thread_b', 'Renamed');
      expect(thread).toEqual({ id: 'thread_b', title: 'Renamed' });
    });

    it('throws when the server rejects the request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 403, json: async () => null }) as Response),
      );
      await expect(renameThread('token', 'lobby-1', 'thread_b', 'Renamed')).rejects.toThrow(
        'rename thread failed: 403',
      );
    });
  });

  describe('deleteThread', () => {
    it('DELETEs thread on the server', async () => {
      const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
        expect(input).toBe('/api/rooms/lobby-1/threads/thread_b');
        expect(init?.method).toBe('DELETE');
        return { ok: true, status: 204, json: async () => null } as Response;
      });
      vi.stubGlobal('fetch', fetchMock);

      await deleteThread('token', 'lobby-1', 'thread_b');
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('throws when the server rejects the request', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404, json: async () => null }) as Response),
      );
      await expect(deleteThread('token', 'lobby-1', 'thread_b')).rejects.toThrow('delete thread failed: 404');
    });
  });

  describe('disengageAgent', () => {
    it('DELETEs engaged agent and returns updated list', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: string, _init?: RequestInit) => ({
          ok: true,
          json: async () => ({ agents: ['diego'] }),
        }) as Response),
      );

      const agents = await disengageAgent('token', 'lobby', 'main', 'sarah');

      expect(fetch).toHaveBeenCalledWith(
        '/api/rooms/lobby/threads/main/engaged/sarah',
        { method: 'DELETE', headers: { Authorization: 'Bearer token' } },
      );
      expect(agents).toEqual(['diego']);
    });

    it('throws when disengage request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 500, json: async () => null }) as Response),
      );

      await expect(disengageAgent('token', 'lobby', 'main', 'sarah')).rejects.toThrow(
        'disengage failed: 500',
      );
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from './api';
import { App } from './App';
import type { BootstrapPayload, WebChatMessage } from './types';

const actualApi = vi.hoisted(() => ({
  loadThreads: null as typeof api.loadThreads | null,
  sendMessage: null as typeof api.sendMessage | null,
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  actualApi.loadThreads = actual.loadThreads;
  actualApi.sendMessage = actual.sendMessage;
  return {
    ...actual,
    loadThreads: vi.fn(actual.loadThreads),
    sendMessage: vi.fn(actual.sendMessage),
  };
});

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'u1', displayName: 'Test User' },
  rooms: [
    { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' },
    { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah' },
    { platformId: 'lobby-2', name: 'Other Lobby', kind: 'lobby' },
  ],
  agents: [
    { folder: 'sarah', name: 'Sarah', mention: '@sarah' },
    { folder: 'team', name: 'Team', mention: '@team' },
  ],
};

const messageFixture: WebChatMessage = {
  id: 'msg-1',
  direction: 'outbound',
  text: 'Agent reply',
  timestamp: 1_700_000_000_000,
  platformId: 'lobby-1',
  threadId: 'main',
};

interface MockWebSocket {
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null;
  close: ReturnType<typeof vi.fn>;
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse<T>(body: T, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function parseMessagePath(url: string): { platformId: string; threadId: string } | null {
  const match = url.match(/\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/messages/);
  if (!match) return null;
  return {
    platformId: decodeURIComponent(match[1]),
    threadId: decodeURIComponent(match[2]),
  };
}

function createFetchMock(handlers: {
  bootstrap?: BootstrapPayload;
  messages?: WebChatMessage[];
  messagesForThread?: (platformId: string, threadId: string) => WebChatMessage[];
  bootstrapError?: number;
  messagesError?: number;
  sendError?: number;
}): FetchHandler {
  return async (input, init) => {
    const url = String(input);
    if (url === '/api/bootstrap') {
      if (handlers.bootstrapError) {
        return jsonResponse(null, false, handlers.bootstrapError);
      }
      return jsonResponse(handlers.bootstrap ?? bootstrapFixture);
    }
    if (url.includes('/messages') && init?.method === 'POST') {
      if (handlers.sendError) {
        return jsonResponse(null, false, handlers.sendError);
      }
      return jsonResponse(null);
    }
    if (url.includes('/messages')) {
      if (handlers.messagesError) {
        return jsonResponse(null, false, handlers.messagesError);
      }
      const path = parseMessagePath(url);
      if (handlers.messagesForThread && path) {
        return jsonResponse({ messages: handlers.messagesForThread(path.platformId, path.threadId) });
      }
      return jsonResponse({ messages: handlers.messages ?? [] });
    }
    throw new Error(`Unhandled fetch: ${url}`);
  };
}

function createWebSocketMock(onOpen?: (ws: MockWebSocket) => void) {
  class MockWebSocketImpl {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static instances: MockWebSocketImpl[] = [];
    url: string;
    readyState = MockWebSocketImpl.OPEN;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    close = vi.fn(() => {
      this.readyState = MockWebSocketImpl.CLOSED;
      this.onclose?.();
    });

    constructor(url: string) {
      this.url = url;
      MockWebSocketImpl.instances.push(this);
      onOpen?.(this);
    }
  }

  MockWebSocketImpl.instances = [];
  vi.stubGlobal('WebSocket', MockWebSocketImpl);
  return MockWebSocketImpl;
}

function latestWebSocket<T extends { instances: MockWebSocket[] }>(MockWebSocket: T): MockWebSocket {
  const ws = MockWebSocket.instances.at(-1);
  if (!ws) throw new Error('expected websocket instance');
  return ws;
}

function messageText(text: string): HTMLElement {
  const node = document.querySelector('.msg');
  if (!node?.textContent?.includes(text)) {
    throw new Error(`expected message "${text}" in .msg`);
  }
  return node as HTMLElement;
}

describe('App', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(api.loadThreads).mockImplementation(actualApi.loadThreads!);
    vi.mocked(api.sendMessage).mockImplementation(actualApi.sendMessage!);
    vi.mocked(api.loadThreads).mockClear();
    vi.mocked(api.sendMessage).mockClear();
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:3200',
      search: '',
    });
    vi.stubGlobal('fetch', vi.fn(createFetchMock({})));
    vi.stubGlobal('crypto', { randomUUID: () => 'new-thread-uuid' });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders auth screen when no token is stored', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'NanoClaw Web Chat' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bearer token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('connects with entered token and loads chat UI', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Bearer token'), 'secret-token');
    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('heading', { name: 'NanoClaw' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
    expect(sessionStorage.getItem('webchat_token')).toBe('secret-token');
    expect(screen.getByText(/Lobby mentions: @sarah, @team, @team/)).toBeInTheDocument();
  });

  it('shows bootstrap errors on the auth flow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ bootstrapError: 401 })),
    );
    sessionStorage.setItem('webchat_token', 'bad-token');

    render(<App />);

    expect(await screen.findByText('bootstrap failed: 401')).toBeInTheDocument();
  });

  it('loads stored threads and messages for the selected room', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_saved', title: 'Saved Thread' },
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Saved Thread' })).toBeInTheDocument();
    expect(await screen.findByText('Agent reply')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('shows the agent name for outbound messages in a DM room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [{ platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah' }],
            agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
          },
          messages: [{ ...messageFixture, platformId: 'dm-sarah' }],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByText('Agent reply')).toBeInTheDocument();
    const replyRow = screen.getByText('Agent reply').closest('.msg');
    expect(replyRow?.querySelector('.msg-sender')?.textContent).toBe('Sarah');
  });

  it('shows the mentioned agent name for lobby replies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            {
              id: 'in-1',
              direction: 'inbound',
              text: '@sarah hello',
              timestamp: 1,
              platformId: 'lobby-1',
              threadId: 'main',
            },
            messageFixture,
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByText('Agent reply')).toBeInTheDocument();
    const replyRow = screen.getByText('Agent reply').closest('.msg');
    expect(replyRow?.querySelector('.msg-sender')?.textContent).toBe('Sarah');
  });

  it('renders inline code and fenced blocks in chat messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            {
              id: 'code-1',
              direction: 'outbound',
              text: 'Try `npm install` then:\n```\npnpm dev\n```',
              timestamp: 1,
              platformId: 'lobby-1',
              threadId: 'main',
            },
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByText('npm install')).toBeInTheDocument();
    expect(screen.getByText('pnpm dev')).toBeInTheDocument();
    expect(document.querySelector('.msg .inline-code')?.textContent).toBe('npm install');
    expect(document.querySelector('.msg .code-block')?.textContent?.trim()).toBe('pnpm dev');
  });

  it('switches rooms and reloads thread state', async () => {
    sessionStorage.setItem('webchat_token', 'secret');

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    await user.click(screen.getByRole('button', { name: 'Sarah' }));

    expect(await screen.findByRole('heading', { name: 'Sarah' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument();
  });

  it('switches threads within the current room', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Thread B' }));

    expect(screen.getByRole('heading', { name: 'Lobby — Thread B' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Thread B' })).toHaveClass('active');
    });
  });

  it('sends a message optimistically and clears the draft', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const textarea = screen.getByPlaceholderText(/Message… use @folder/);
    await user.type(textarea, 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    expect(textarea).toHaveValue('');
    expect(fetch).toHaveBeenCalledWith(
      '/api/rooms/lobby-1/threads/main/messages',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'hello world' }),
      }),
    );
  });

  it('sends on Enter without Shift and ignores Shift+Enter', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const textarea = screen.getByPlaceholderText(/Message… use @folder/);
    await user.type(textarea, 'enter send');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(document.querySelector('.msg')).toBeNull();
    expect(textarea).toHaveValue('enter send\n');

    await user.keyboard('{Enter}');
    await waitFor(() => {
      messageText('enter send');
    });
  });

  it('shows send errors and keeps optimistic message visible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ sendError: 500 })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'fail me');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('send failed: 500')).toBeInTheDocument();
    expect(screen.getByText('fail me')).toBeInTheDocument();
  });

  it('handles non-Error send failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const url = String(input);
      if (url === '/api/bootstrap') {
        return jsonResponse(bootstrapFixture);
      }
      if (url.includes('/messages') && init?.method === 'POST') {
        throw 'boom';
      }
      return jsonResponse({ messages: [] });
    }));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'x');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('send failed')).toBeInTheDocument();
  });

  it('creates a new thread and clears messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messagesForThread: (_platformId, threadId) =>
            threadId === 'main' ? [messageFixture] : [],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Agent reply');

    await user.click(screen.getByRole('button', { name: 'New thread in Lobby' }));

    expect(await screen.findByRole('button', { name: 'Thread 1' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('webchat_threads:lobby-1')).toContain('thread_new-thread-uuid');
  });

  it('auto-names a thread from the first message', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    vi.mocked(api.loadThreads).mockClear();

    await user.click(screen.getByRole('button', { name: 'New thread in Lobby' }));
    await screen.findByRole('button', { name: 'Thread 1' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'Review the auth flow');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Review the auth flow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thread 1' })).not.toBeInTheDocument();
    expect(vi.mocked(api.loadThreads)).not.toHaveBeenCalled();
  });

  it('renames a thread from the sidebar', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    const renameInput = screen.getByLabelText('Thread name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed topic{Enter}');

    expect(await screen.findByRole('button', { name: 'Renamed topic' })).toBeInTheDocument();
    expect(localStorage.getItem('webchat_threads:lobby-1')).toContain('Renamed topic');
  });

  it('appends websocket messages for the active room and thread', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);

    expect(await screen.findByText('Agent reply')).toBeInTheDocument();
  });

  it('ignores duplicate websocket messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByText('Agent reply');

    const ws = latestWebSocket(MockWebSocket);
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({ type: 'message', message: messageFixture }),
      } as MessageEvent);
    });

    expect(screen.getAllByText('Agent reply')).toHaveLength(1);
  });

  it('ignores duplicate websocket messages received live on the active conversation', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);
    expect(await screen.findByText('Agent reply')).toBeInTheDocument();

    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);
    expect(screen.getAllByText('Agent reply')).toHaveLength(1);
  });

  it('tracks unread counts for other rooms and threads via websocket', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, id: 'msg-dm', platformId: 'dm-sarah' },
      }),
    } as MessageEvent);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, id: 'msg-thread', threadId: 'thread_b' },
      }),
    } as MessageEvent);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'typing', platformId: 'lobby-1', threadId: 'main' }),
    } as MessageEvent);

    expect(await screen.findByRole('button', { name: 'Sarah, 1 unread message' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Thread B, 1 unread message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sarah, 1 unread message' })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: 'Thread B, 1 unread message' })).toHaveTextContent('1');
    expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
  });

  it('clears unread when selecting a room or thread', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, id: 'msg-thread', threadId: 'thread_b' },
      }),
    } as MessageEvent);

    expect(await screen.findByRole('button', { name: 'Thread B, 1 unread message' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thread B, 1 unread message' }));

    expect(screen.queryByRole('button', { name: /unread message/ })).not.toBeInTheDocument();
  });

  it('increments unread on the previous room after switching channels', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.click(screen.getByRole('button', { name: 'Sarah' }));
    expect(await screen.findByRole('heading', { name: 'Sarah' })).toBeInTheDocument();

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);

    expect(await screen.findByRole('button', { name: 'Lobby, 1 unread message' })).toBeInTheDocument();
    expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
  });

  it('syncs unread for inactive rooms when the socket opens and on interval', async () => {
    const fetchMessagesSpy = vi.spyOn(api, 'fetchMessages');
    fetchMessagesSpy.mockImplementation(async (_token, platformId, threadId, since = 0) => {
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) return [];
      if (platformId === 'dm-sarah' && threadId === 'main') {
        return [
          {
            ...messageFixture,
            id: 'sync-msg',
            platformId: 'dm-sarah',
            timestamp: since + 1000,
          },
        ];
      }
      if (platformId === 'lobby-2' && threadId === 'main') {
        return [
          {
            ...messageFixture,
            id: 'sync-lobby-2',
            platformId: 'lobby-2',
            timestamp: since + 1000,
          },
        ];
      }
      return [];
    });

    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    await act(async () => {
      ws.onopen?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByRole('button', { name: 'Sarah, 1 unread message' })).toBeInTheDocument();

    fetchMessagesSpy.mockRestore();
  });

  it('polls inactive rooms on an interval', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMessagesSpy = vi.spyOn(api, 'fetchMessages');
    fetchMessagesSpy.mockImplementation(async (_token, platformId, threadId, since = 0) => {
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) return [];
      return [];
    });

    sessionStorage.setItem('webchat_token', 'secret');
    createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const callsBefore = fetchMessagesSpy.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });

    expect(fetchMessagesSpy.mock.calls.length).toBeGreaterThan(callsBefore);
    fetchMessagesSpy.mockRestore();
    vi.useRealTimers();
  });

  it('skips the interval tick immediately after websocket open sync', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMessagesSpy = vi.spyOn(api, 'fetchMessages');
    fetchMessagesSpy.mockImplementation(async (_token, platformId, threadId, since = 0) => {
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) return [];
      return [];
    });

    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    const callsBeforeOpen = fetchMessagesSpy.mock.calls.length;
    await act(async () => {
      ws.onopen?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsAfterOpen = fetchMessagesSpy.mock.calls.length;
    expect(callsAfterOpen).toBeGreaterThan(callsBeforeOpen);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(fetchMessagesSpy.mock.calls.length).toBe(callsAfterOpen);

    fetchMessagesSpy.mockRestore();
    vi.useRealTimers();
  });

  it('ignores overlapping sync runs while a fetch is in flight', async () => {
    let releaseFetch: () => void = () => undefined;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMessagesSpy = vi.spyOn(api, 'fetchMessages');
    fetchMessagesSpy.mockImplementation(async (_token, platformId, threadId, since = 0) => {
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) return [];
      await fetchGate;
      return [];
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    await act(async () => {
      ws.onopen?.();
      await Promise.resolve();
    });
    const callsAfterOpen = fetchMessagesSpy.mock.calls.length;
    expect(callsAfterOpen).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(fetchMessagesSpy.mock.calls.length).toBe(callsAfterOpen);

    releaseFetch();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fetchMessagesSpy.mockRestore();
    vi.useRealTimers();
  });

  it('ignores duplicate websocket unread events for inactive conversations', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    const inactiveMessage = { ...messageFixture, id: 'msg-dm', platformId: 'dm-sarah' };
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: inactiveMessage }),
    } as MessageEvent);
    expect(await screen.findByRole('button', { name: 'Sarah, 1 unread message' })).toBeInTheDocument();

    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: inactiveMessage }),
    } as MessageEvent);
    expect(screen.getByRole('button', { name: 'Sarah, 1 unread message' })).toHaveTextContent('1');
  });

  it('ignores background sync errors for inactive rooms', async () => {
    const fetchMessagesSpy = vi.spyOn(api, 'fetchMessages');
    fetchMessagesSpy.mockImplementation(async (_token, platformId, threadId, since = 0) => {
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) return [];
      if (platformId === 'dm-sarah') throw new Error('network');
      return [];
    });

    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    await act(async () => {
      ws.onopen?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole('button', { name: /unread message/ })).not.toBeInTheDocument();
    fetchMessagesSpy.mockRestore();
  });

  it('clears unread when messages are loaded for the active conversation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, id: 'msg-thread', threadId: 'thread_b' },
      }),
    } as MessageEvent);
    expect(await screen.findByRole('button', { name: 'Thread B, 1 unread message' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Thread B, 1 unread message' }));
    expect(await screen.findByText('Agent reply')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /unread message/ })).not.toBeInTheDocument();
  });

  it('shows message fetch errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messagesError: 503 })),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByText('messages failed: 503')).toBeInTheDocument();
  });

  it('uses first room when no lobby exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [{ platformId: 'dm-only', name: 'Only DM', kind: 'dm' }],
            agents: [],
          },
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Only DM' })).toBeInTheDocument();
    expect(screen.queryByText(/Lobby mentions/)).not.toBeInTheDocument();
  });

  it('stays on connecting screen when bootstrap has no rooms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [],
            agents: [],
          },
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByText('Connecting…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'NanoClaw' })).not.toBeInTheDocument();
  });

  it('does not send when draft is blank or already sending', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton).toBeDisabled();

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), '   ');
    expect(sendButton).toBeDisabled();
  });

  it('closes websocket on unmount', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    unmount();

    expect(ws.close).toHaveBeenCalled();
  });

  it('cancels in-flight message fetch when dependencies change', async () => {
    let resolveMessages: (value: Response) => void = () => undefined;
    const messagesPromise = new Promise<Response>((resolve) => {
      resolveMessages = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === '/api/bootstrap') {
          return jsonResponse(bootstrapFixture);
        }
        if (url.includes('/messages')) {
          return messagesPromise;
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.click(screen.getByRole('button', { name: 'Sarah' }));
    resolveMessages(jsonResponse({ messages: [{ ...messageFixture, text: 'stale' }] }));

    unmount();
    await waitFor(() => {
      expect(screen.queryByText('stale')).not.toBeInTheDocument();
    });
  });

  it('scrolls to the bottom when messages change', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<App />);
    await screen.findByText('Agent reply');

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('highlights active room buttons in each section', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    const roomsSection = screen.getByText('Rooms').closest('.nav-section');
    expect(roomsSection).not.toBeNull();
    const lobbyButton = within(roomsSection as HTMLElement).getByRole('button', { name: 'Lobby' });
    expect(lobbyButton).toHaveClass('active');
  });

  it('switches between lobby rooms from the sidebar', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const roomsSection = screen.getByText('Rooms').closest('.nav-section');
    const otherLobby = within(roomsSection as HTMLElement).getByRole('button', { name: 'Other Lobby' });
    expect(otherLobby).not.toHaveClass('active');

    await user.click(otherLobby);

    expect(otherLobby).toHaveClass('active');
    expect(screen.getByRole('heading', { name: 'Other Lobby' })).toBeInTheDocument();
  });

  it('connects websocket after bootstrap loads', async () => {
    let resolveBootstrap: (value: Response) => void = () => undefined;
    const bootstrapPromise = new Promise<Response>((resolve) => {
      resolveBootstrap = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === '/api/bootstrap') return bootstrapPromise;
        if (url.includes('/messages')) return jsonResponse({ messages: [] });
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);

    expect(MockWebSocket.instances).toHaveLength(0);

    resolveBootstrap(jsonResponse(bootstrapFixture));
    await screen.findByRole('heading', { name: 'Lobby' });
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });

  it('omits the extra @team suffix when @team is not configured', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
          },
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByText('Lobby mentions: @sarah')).toBeInTheDocument();
    expect(screen.queryByText(/@team/)).not.toBeInTheDocument();
  });

  it('highlights the active thread and keeps others inactive', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    const lobbyButton = screen.getByRole('button', { name: 'Lobby' });
    const threadBButton = screen.getByRole('button', { name: 'Thread B' });
    expect(lobbyButton).toHaveClass('active');
    expect(threadBButton).not.toHaveClass('active');

    await user.click(threadBButton);

    expect(lobbyButton).not.toHaveClass('active');
    expect(threadBButton).toHaveClass('active');
  });

  it('updates the token input while on the auth screen', async () => {
    const user = userEvent.setup();
    render(<App />);

    const tokenInput = screen.getByLabelText('Bearer token');
    await user.type(tokenInput, 'abc');
    expect(tokenInput).toHaveValue('abc');
  });

  it('shows an auth error when connect is clicked without a token', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Connect' }));

    expect(screen.getByText('Token required')).toBeInTheDocument();
  });

  it('falls back to the main thread id when stored threads are empty', async () => {
    vi.mocked(api.loadThreads).mockReturnValue([]);
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    await screen.findByRole('heading', { name: 'Lobby' });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/rooms/lobby-1/threads/main/messages',
        expect.anything(),
      );
    });
  });

  it('ignores send attempts when the draft is empty', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const textarea = screen.getByPlaceholderText(/Message… use @folder/);
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send again while a message is already in flight', async () => {
    vi.mocked(api.sendMessage).mockImplementation(() => new Promise(() => {}));
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const textarea = screen.getByPlaceholderText(/Message… use @folder/);
    fireEvent.change(textarea, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith('secret', 'lobby-1', 'main', 'first');
  });

  it('deletes a thread from the sidebar and returns to main', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Thread B' }));
    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(screen.queryByRole('button', { name: 'Thread B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lobby' })).toHaveClass('active');
    expect(localStorage.getItem('webchat_threads:lobby-1')).not.toContain('thread_b');
  });

  it('renders theme toggle in authenticated view', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'System' })).toBeInTheDocument();
  });

  it('persists dark theme preference when selected', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('webchat_theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves theme selection with arrow keys', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    localStorage.setItem('webchat_theme', 'light');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    const lightRadio = screen.getByRole('radio', { name: 'Light' });
    lightRadio.focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
    expect(localStorage.getItem('webchat_theme')).toBe('system');
  });

  it('collapses expanded threads from the sidebar caret', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Collapse threads in Lobby' }));

    expect(screen.queryByRole('button', { name: 'Thread B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand threads in Lobby' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand threads in Lobby' }));
    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();
  });

  it('skips thread rename when the title is unchanged or blank', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    const renameInput = screen.getByLabelText('Thread name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Thread B{Enter}');

    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();
    expect(localStorage.getItem('webchat_threads:lobby-1')).toContain('"title":"Thread B"');
    expect(localStorage.getItem('webchat_threads:lobby-1')).not.toContain('Renamed');

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    await user.clear(screen.getByLabelText('Thread name'));
    await user.type(screen.getByLabelText('Thread name'), '   {Enter}');

    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();
  });

  it('deletes a child thread while viewing the room main thread', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(screen.queryByRole('button', { name: 'Thread B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lobby' })).toHaveClass('active');
    expect(screen.getByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
  });

  it('deletes a thread in another room without changing the active view', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_b', title: 'Thread B' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Sarah' }));
    expect(screen.getByRole('heading', { name: 'Sarah' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(screen.queryByRole('button', { name: 'Thread B' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sarah' })).toBeInTheDocument();
  });

  it('does not auto-rename a thread that already has a custom title', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'custom-thread', title: 'Custom topic' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Custom topic' });

    await user.click(screen.getByRole('button', { name: 'Custom topic' }));
    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'First message in thread');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByRole('button', { name: 'Custom topic' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'First message in thread' })).not.toBeInTheDocument();
  });

  it('shows a generic error when send fails with a non-Error value', async () => {
    vi.mocked(api.sendMessage).mockRejectedValueOnce('network down');
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('send failed')).toBeInTheDocument();
  });

  it('clears data-theme when system preference is selected', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    localStorage.setItem('webchat_theme', 'dark');
    document.documentElement.dataset.theme = 'dark';

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    await user.click(screen.getByRole('radio', { name: 'System' }));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('webchat_theme')).toBe('system');
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute('aria-checked', 'true');
  });
});

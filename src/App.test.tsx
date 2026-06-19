import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    static instances: MockWebSocketImpl[] = [];
    url: string;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    close = vi.fn();

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

    expect(await screen.findByRole('heading', { name: 'NanoClaw Chat' })).toBeInTheDocument();
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

  it('switches rooms and reloads thread state', async () => {
    localStorage.setItem(
      'webchat_threads:dm-sarah',
      JSON.stringify([{ id: 'main', title: 'DM Main' }]),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw Chat' });

    await user.click(screen.getByRole('button', { name: 'Sarah' }));

    expect(await screen.findByRole('button', { name: 'DM Main' })).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Send' }));

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
    await user.click(screen.getByRole('button', { name: 'Send' }));

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
    await user.click(screen.getByRole('button', { name: 'Send' }));

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

    await user.click(screen.getByRole('button', { name: 'New thread' }));

    expect(await screen.findByRole('button', { name: 'Thread 1' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem('webchat_threads:lobby-1')).toContain('thread_new-thread-uuid');
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
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);

    expect(screen.getAllByText('Agent reply')).toHaveLength(1);
  });

  it('ignores websocket messages for other rooms or threads', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, platformId: 'other-room' },
      }),
    } as MessageEvent);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, threadId: 'other-thread' },
      }),
    } as MessageEvent);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'typing', platformId: 'lobby-1', threadId: 'main' }),
    } as MessageEvent);

    expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('heading', { name: 'NanoClaw Chat' })).not.toBeInTheDocument();
  });

  it('does not send when draft is blank or already sending', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const sendButton = screen.getByRole('button', { name: 'Send' });
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
    await screen.findByRole('heading', { name: 'NanoClaw Chat' });

    const roomsSection = screen.getByRole('heading', { name: 'Rooms' }).closest('section');
    expect(roomsSection).not.toBeNull();
    const lobbyButton = within(roomsSection as HTMLElement).getByRole('button', { name: 'Lobby' });
    expect(lobbyButton).toHaveClass('active');
  });

  it('switches between lobby rooms from the sidebar', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const roomsSection = screen.getByRole('heading', { name: 'Rooms' }).closest('section');
    const otherLobby = within(roomsSection as HTMLElement).getByRole('button', { name: 'Other Lobby' });
    expect(otherLobby).not.toHaveClass('active');

    await user.click(otherLobby);

    expect(otherLobby).toHaveClass('active');
    expect(screen.getByRole('heading', { name: 'Other Lobby' })).toBeInTheDocument();
  });

  it('ignores websocket messages before the active room is known', async () => {
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

    const ws = latestWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);

    resolveBootstrap(jsonResponse(bootstrapFixture));
    await screen.findByRole('heading', { name: 'Lobby' });
    expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
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

    const mainButton = screen.getByRole('button', { name: 'Main' });
    const threadBButton = screen.getByRole('button', { name: 'Thread B' });
    expect(mainButton).toHaveClass('active');
    expect(threadBButton).not.toHaveClass('active');

    await user.click(threadBButton);

    expect(mainButton).not.toHaveClass('active');
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
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith('secret', 'lobby-1', 'main', 'first');
  });
});

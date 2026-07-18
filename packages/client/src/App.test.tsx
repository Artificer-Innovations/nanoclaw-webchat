import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as api from './api';
import * as appHelpers from './app-helpers';
import * as attachments from './attachments';
import * as chatScroll from './chat-scroll';
import { App } from './App';
import type { BootstrapPayload, WebChatMessage } from './types';

const threadMocks = vi.hoisted(() => ({
  createThreadImpl: async (_token: string, _platformId: string, title: string) => ({
    id: title === 'Saved Thread' ? 'thread_saved' : 'thread_new-thread-uuid',
    title,
  }),
  renameThreadImpl: async (_token: string, _platformId: string, threadId: string, title: string) => ({
    id: threadId,
    title,
  }),
  deleteThreadImpl: async () => {},
}));

const actualApi = vi.hoisted(() => ({
  sendMessage: null as typeof api.sendMessage | null,
  detectPublicAuthMode: null as typeof api.detectPublicAuthMode | null,
  createThread: vi.fn(threadMocks.createThreadImpl),
  renameThread: vi.fn(threadMocks.renameThreadImpl),
  deleteThread: vi.fn(threadMocks.deleteThreadImpl),
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  actualApi.sendMessage = actual.sendMessage;
  actualApi.detectPublicAuthMode = actual.detectPublicAuthMode;
  return {
    ...actual,
    createThread: actualApi.createThread,
    renameThread: actualApi.renameThread,
    deleteThread: actualApi.deleteThread,
    sendMessage: vi.fn(actual.sendMessage),
    detectPublicAuthMode: vi.fn(actual.detectPublicAuthMode),
    submitAction: vi.fn(actual.submitAction),
  };
});

const defaultThreads = [{ id: 'main', title: 'Main' }];

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'u1', displayName: 'Test User' },
  rooms: [
    { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby', threads: [...defaultThreads] },
    { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah', threads: [...defaultThreads] },
    { platformId: 'lobby-2', name: 'Other Lobby', kind: 'lobby', threads: [...defaultThreads] },
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

function bootstrapWithLobbyThreads(
  threads: Array<{ id: string; title: string }>,
): BootstrapPayload {
  return {
    ...bootstrapFixture,
    rooms: [
      { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby', threads },
      ...bootstrapFixture.rooms.slice(1),
    ],
  };
}

function messagesResponse(
  messages: WebChatMessage[],
  engagedAgents: string[] = [],
): { messages: WebChatMessage[]; engagedAgents: string[] } {
  return { messages, engagedAgents };
}

function createFetchMock(handlers: {
  bootstrap?: BootstrapPayload;
  messages?: WebChatMessage[];
  engagedAgents?: string[];
  disengageResult?: string[];
  activity?: unknown[];
  messagesForThread?: (
    platformId: string,
    threadId: string,
  ) => { messages: WebChatMessage[]; engagedAgents?: string[] };
  bootstrapError?: number;
  messagesError?: number;
  sendError?: number;
  disengageError?: number;
  uploadError?: number;
}): FetchHandler {
  return async (input, init) => {
    const url = String(input);
    if (url === '/api/auth/config') {
      return jsonResponse(null, false, 404);
    }
    if (url === '/api/auth/me') {
      return jsonResponse(null, false, 401);
    }
    if (url === '/api/bootstrap') {
      if (handlers.bootstrapError) {
        return jsonResponse(null, false, handlers.bootstrapError);
      }
      return jsonResponse(handlers.bootstrap ?? bootstrapFixture);
    }
    if (url.includes('/engaged/') && init?.method === 'DELETE') {
      if (handlers.disengageError) {
        return jsonResponse(null, false, handlers.disengageError);
      }
      return jsonResponse({ agents: handlers.disengageResult ?? [] });
    }
    if (url.includes('/uploads/chunk') && init?.method === 'POST') {
      if (handlers.uploadError) {
        return jsonResponse(null, false, handlers.uploadError);
      }
      const body = JSON.parse(String(init.body)) as { filename?: string; mimeType?: string };
      return jsonResponse({
        uploadId: '550e8400-e29b-41d4-a716-446655440000',
        name: body.filename ?? 'upload.bin',
        mimeType: body.mimeType ?? 'application/octet-stream',
        type: 'file',
        size: 5,
      });
    }
    if (url.includes('/uploads') && init?.method === 'POST') {
      if (handlers.uploadError) {
        return jsonResponse(null, false, handlers.uploadError);
      }
      return jsonResponse({
        uploadId: '550e8400-e29b-41d4-a716-446655440000',
        name: 'photo.png',
        mimeType: 'image/png',
        type: 'image',
        size: 5,
      });
    }
    if (url.includes('/messages') && init?.method === 'POST') {
      if (handlers.sendError) {
        return jsonResponse(null, false, handlers.sendError);
      }
      return jsonResponse({ messageId: 'web-test', timestamp: Date.now() });
    }
    if (url.includes('/actions') && init?.method === 'POST') {
      return jsonResponse({ ok: true });
    }
    if (url.includes('/activity')) {
      return jsonResponse({ platformId: 'lobby-1', threadId: 'main', events: handlers.activity ?? [] });
    }
    if (url.includes('/messages')) {
      if (handlers.messagesError) {
        return jsonResponse(null, false, handlers.messagesError);
      }
      const path = parseMessagePath(url);
      if (handlers.messagesForThread && path) {
        const payload = handlers.messagesForThread(path.platformId, path.threadId);
        return jsonResponse(messagesResponse(payload.messages, payload.engagedAgents ?? []));
      }
      return jsonResponse(
        messagesResponse(handlers.messages ?? [], handlers.engagedAgents ?? []),
      );
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

async function waitForWebSocket<T extends { instances: MockWebSocket[] }>(
  MockWebSocket: T,
): Promise<MockWebSocket> {
  await waitFor(() => {
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
  });
  return latestWebSocket(MockWebSocket);
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
    document.head.querySelectorAll('meta[name="webchat-token"]').forEach((node) => node.remove());
    vi.mocked(api.sendMessage).mockImplementation(actualApi.sendMessage!);
    vi.mocked(api.detectPublicAuthMode).mockImplementation(actualApi.detectPublicAuthMode!);
    vi.mocked(api.submitAction).mockResolvedValue(undefined);
    vi.mocked(api.createThread).mockImplementation(threadMocks.createThreadImpl);
    vi.mocked(api.renameThread).mockImplementation(threadMocks.renameThreadImpl);
    vi.mocked(api.deleteThread).mockImplementation(threadMocks.deleteThreadImpl);
    vi.mocked(api.sendMessage).mockClear();
    vi.mocked(api.createThread).mockClear();
    vi.mocked(api.renameThread).mockClear();
    vi.mocked(api.deleteThread).mockClear();
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
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders setup hint when no token is available', async () => {
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'NanoClaw Web Chat' })).toBeInTheDocument();
    expect(screen.getByText(/Open this UI from the NanoClaw webchat server/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Bearer token')).not.toBeInTheDocument();
  });

  it('renders login page when public auth is enabled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return jsonResponse(null, false, 401);
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('falls back to local mode when public auth detection rejects', async () => {
    vi.mocked(api.detectPublicAuthMode).mockRejectedValue(new Error('network'));
    render(<App />);
    expect(await screen.findByText(/Open this UI from the NanoClaw webchat server/)).toBeInTheDocument();
  });

  it('shows login when public session lookup fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return jsonResponse(null, false, 500);
        }
        throw new Error(`Unhandled fetch: ${url}`);
      }),
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('connects using injected token meta and loads chat UI', async () => {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'webchat-token');
    meta.setAttribute('content', 'secret-token');
    document.head.appendChild(meta);

    render(<App />);

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

  it('loads server threads and messages for the selected room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              {
                platformId: 'lobby-1',
                name: 'Lobby',
                kind: 'lobby',
                threads: [
                  { id: 'main', title: 'Main' },
                  { id: 'thread_saved', title: 'Saved Thread' },
                ],
              },
              ...bootstrapFixture.rooms.slice(1),
            ],
          },
          messages: [messageFixture],
        }),
      ),
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
            rooms: [{ platformId: 'dm-sarah', name: 'Sarah', kind: 'dm', folder: 'sarah', threads: defaultThreads }],
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

  it('shows engaged agents listening in the lobby composer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [],
          engagedAgents: ['sarah', 'team'],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Stop Sarah from listening' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Stop Team from listening' })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Message… agents you've @'d keep listening in this thread"),
    ).toBeInTheDocument();
  });

  it('falls back to folder names for unknown engaged agents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [],
          engagedAgents: ['unknown-agent'],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Stop unknown-agent from listening' })).toBeInTheDocument();
  });

  it('optimistically adds mentioned agents to engaged state on send', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByRole('textbox'), '@sarah hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Stop Sarah from listening' })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox'), '@team join us');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Stop Team from listening' })).toBeInTheDocument();
  });

  it('sends without optimistic sender metadata when bootstrap has no user', async () => {
    const bootstrapWithoutUser = { rooms: bootstrapFixture.rooms, agents: bootstrapFixture.agents } as BootstrapPayload;
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [], bootstrap: bootstrapWithoutUser })));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByRole('textbox'), 'hello without user');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('hello without user')).toBeInTheDocument();
  });

  it('does not track engaged agents when sending in a DM', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [], sendError: 500 })));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.click(screen.getByRole('button', { name: 'Sarah' }));
    await user.type(screen.getByRole('textbox'), '@sarah direct hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('send failed: 500')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stop .* from listening/i })).not.toBeInTheDocument();
  });

  it('merges new mentions into existing engaged state on send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [], engagedAgents: ['sarah'] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Stop Sarah from listening' });

    await user.type(screen.getByRole('textbox'), '@team join us');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Stop Team from listening' })).toBeInTheDocument();
  });

  it('keeps engaged state when sending a follow-up without new mentions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [], engagedAgents: ['sarah'] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Stop Sarah from listening' });

    await user.type(screen.getByRole('textbox'), 'thanks');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByRole('button', { name: 'Stop Sarah from listening' })).toBeInTheDocument();
  });

  it('removes engaged agent when chip dismiss is clicked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [], engagedAgents: ['sarah', 'team'], disengageResult: ['team'] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Stop Sarah from listening' });

    await user.click(screen.getByRole('button', { name: 'Stop Sarah from listening' }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop Sarah from listening' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Stop Team from listening' })).toBeInTheDocument();
  });

  it('restores engaged agents when disengage request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [],
          engagedAgents: ['sarah', 'team'],
          disengageError: 500,
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Stop Sarah from listening' });

    await user.click(screen.getByRole('button', { name: 'Stop Sarah from listening' }));

    expect(await screen.findByText('disengage failed: 500')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop Sarah from listening' })).toBeInTheDocument();
  });

  it('shows generic error when disengage throws a non-Error', async () => {
    vi.spyOn(api, 'disengageAgent').mockRejectedValue('nope');
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [], engagedAgents: ['sarah'] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Stop Sarah from listening' });

    await user.click(screen.getByRole('button', { name: 'Stop Sarah from listening' }));

    expect(await screen.findByText('Failed to remove agent')).toBeInTheDocument();
    vi.mocked(api.disengageAgent).mockRestore();
  });

  it('skips engaged tracking when bootstrap lists no agents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: { ...bootstrapFixture, agents: [] },
          messages: [],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByRole('textbox'), '@sarah hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.queryByRole('button', { name: /Stop .* from listening/i })).not.toBeInTheDocument();
  });

  it('updates engaged agents from websocket events', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'engaged',
          platformId: 'lobby-1',
          threadId: 'main',
          agents: ['sarah'],
        }),
      } as MessageEvent);
    });

    expect(await screen.findByRole('button', { name: 'Stop Sarah from listening' })).toBeInTheDocument();
  });

  it('applies message_update websocket events in the active thread', async () => {
    const cardMessage: WebChatMessage = {
      id: 'card-1',
      direction: 'inbound',
      text: '',
      timestamp: 2,
      platformId: 'lobby-1',
      threadId: 'main',
      card: {
        type: 'ask_question',
        questionId: 'q1',
        title: 'Approve?',
        question: 'Go live?',
        status: 'pending',
        options: [{ label: 'Yes', value: 'yes' }],
      },
    };
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [cardMessage] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('button', { name: 'Yes' });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'message_update',
          message: {
            ...cardMessage,
            card: {
              ...cardMessage.card!,
              status: 'answered',
              selectedValue: 'yes',
              selectedLabel: 'Yes',
            },
          },
        }),
      } as MessageEvent);
    });

    expect(await screen.findByText('Yes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes' })).not.toBeInTheDocument();
  });

  it('ignores message_update events for inactive threads', async () => {
    const cardMessage: WebChatMessage = {
      id: 'card-1',
      direction: 'inbound',
      text: '',
      timestamp: 2,
      platformId: 'lobby-1',
      threadId: 'main',
      card: {
        type: 'ask_question',
        questionId: 'q1',
        title: 'Approve?',
        question: 'Go live?',
        status: 'pending',
        options: [{ label: 'Yes', value: 'yes' }],
      },
    };
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [cardMessage] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('button', { name: 'Yes' });

    const ws = MockWebSocket.instances[0]!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'message_update',
          message: {
            ...cardMessage,
            threadId: 'thread_b',
            card: { ...cardMessage.card!, status: 'answered', selectedValue: 'yes', selectedLabel: 'Yes' },
          },
        }),
      } as MessageEvent);
    });

    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
  });

  it('loads chat after successful public login', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return jsonResponse(null, false, 401);
        }
        if (url === '/api/auth/login/basic' && init?.method === 'POST') {
          return jsonResponse({ ok: true });
        }
        return createFetchMock({ messages: [] })(input, init);
      }),
    );

    render(<App />);
    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
  });

  it('redirects to returnTo after public login when requested', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:3200',
      origin: 'http://localhost:3200',
      search: '?returnTo=%2Fauthorize%3Fclient%3D1',
      assign,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return jsonResponse(null, false, 401);
        }
        if (url === '/api/auth/login/basic' && init?.method === 'POST') {
          return jsonResponse({ ok: true });
        }
        return createFetchMock({ messages: [] })(input, init);
      }),
    );

    render(<App />);
    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/authorize?client=1');
    });
    expect(screen.queryByRole('heading', { name: 'Lobby' })).not.toBeInTheDocument();
  });

  it('redirects to stashed returnTo when a public session already exists', async () => {
    const assign = vi.fn();
    sessionStorage.setItem('webchat_return_to', '/authorize');
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:3200',
      origin: 'http://localhost:3200',
      search: '',
      assign,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return jsonResponse({ id: 'alice', displayName: 'Alice' });
        }
        return createFetchMock({ messages: [] })(input);
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/authorize');
    });
    expect(screen.queryByRole('heading', { name: 'Lobby' })).not.toBeInTheDocument();
  });

  it('redirects to returnTo from the URL when a public session already exists', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', {
      protocol: 'http:',
      host: 'localhost:3200',
      origin: 'http://localhost:3200',
      search: '?returnTo=%2Fauthorize%3Fclient%3D2',
      assign,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return jsonResponse({ id: 'alice', displayName: 'Alice' });
        }
        return createFetchMock({ messages: [] })(input);
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith('/authorize?client=2');
    });
    expect(screen.queryByRole('heading', { name: 'Lobby' })).not.toBeInTheDocument();
  });

  it('signs out from public auth and returns to login', async () => {
    const user = userEvent.setup();
    let authed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = String(input);
        if (url === '/api/auth/config') {
          return jsonResponse({ basic: { enabled: true }, providers: [] });
        }
        if (url === '/api/auth/me') {
          return authed
            ? jsonResponse({ id: 'alice', displayName: 'Alice' })
            : jsonResponse(null, false, 401);
        }
        if (url === '/api/auth/login/basic' && init?.method === 'POST') {
          authed = true;
          return jsonResponse({ ok: true });
        }
        if (url === '/api/auth/logout' && init?.method === 'POST') {
          authed = false;
          return jsonResponse({ ok: true });
        }
        return createFetchMock({ messages: [] })(input, init);
      }),
    );

    render(<App />);
    await user.type(await screen.findByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lobby' })).not.toBeInTheDocument();
  });

  it('updates inbox messages after interactive card selection', async () => {
    const user = userEvent.setup();
    const cardMessage: WebChatMessage = {
      id: 'card-1',
      direction: 'inbound',
      text: '',
      timestamp: 2,
      platformId: 'inbox',
      threadId: 'main',
      card: {
        type: 'ask_question',
        questionId: 'q1',
        title: 'Approve?',
        question: 'Go live?',
        status: 'pending',
        options: [{ label: 'Yes', value: 'yes', selectedLabel: 'Approved' }],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input, init) => {
        const url = String(input);
        if (url.includes('/actions') && init?.method === 'POST') {
          return jsonResponse({ ok: true });
        }
        if (url.includes('/messages')) {
          return jsonResponse({ messages: [cardMessage], engagedAgents: [] });
        }
        return createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              ...bootstrapFixture.rooms,
              { platformId: 'inbox', name: 'Inbox', kind: 'inbox', threads: [...defaultThreads] },
            ],
          },
        })(input, init);
      }),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    await user.click(screen.getByRole('button', { name: 'Inbox' }));
    await user.click(await screen.findByRole('button', { name: 'Yes' }));

    expect(await screen.findByText('Approved')).toBeInTheDocument();
    expect(api.submitAction).toHaveBeenCalledWith('secret', 'inbox', 'main', 'q1', 'yes');
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');

    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Thread B' }));

    expect(screen.getByRole('heading', { name: 'Lobby — Thread B' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Thread B' }).closest('.nav-thread-row')).toHaveClass('active');
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

  it('reconciles the optimistic message id when history already contains messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Agent reply');

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(screen.getByText('Agent reply')).toBeInTheDocument();
    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getAllByText('hello world')).toHaveLength(1);
  });

  it('does not duplicate when two websocket echoes arrive for queued optimistic sends', async () => {
    vi.spyOn(appHelpers, 'canSendMessage').mockReturnValue(true);
    vi.mocked(api.sendMessage).mockImplementation(() => new Promise(() => {}));
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const textarea = screen.getByPlaceholderText(/Message… use @folder/);
    await user.type(textarea, 'first');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('first');

    await user.type(textarea, 'second');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('second');

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: {
          id: 'web-1',
          direction: 'inbound',
          text: 'first',
          timestamp: 1,
          platformId: 'lobby-1',
          threadId: 'main',
        },
      }),
    } as MessageEvent);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: {
          id: 'web-2',
          direction: 'inbound',
          text: 'second',
          timestamp: 2,
          platformId: 'lobby-1',
          threadId: 'main',
        },
      }),
    } as MessageEvent);

    expect(screen.getAllByText('first')).toHaveLength(1);
    expect(screen.getAllByText('second')).toHaveLength(1);
  });

  it('does not duplicate when the websocket echo arrives before the POST response', async () => {
    let resolveSend: ((value: { messageId: string; timestamp: number }) => void) | undefined;
    vi.mocked(api.sendMessage).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('hello world');

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: {
          id: 'web-race',
          direction: 'inbound',
          text: 'hello world',
          timestamp: 1_700_000_000_000,
          platformId: 'lobby-1',
          threadId: 'main',
        },
      }),
    } as MessageEvent);

    resolveSend?.({ messageId: 'web-race', timestamp: 1_700_000_000_000 });
    await waitFor(() => {
      expect(screen.getAllByText('hello world')).toHaveLength(1);
    });
  });

  it('does not duplicate the user message when the websocket echoes the persisted send', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'hello world');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('hello world');

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: {
          id: 'web-test',
          direction: 'inbound',
          text: 'hello world',
          timestamp: Date.now(),
          platformId: 'lobby-1',
          threadId: 'main',
        },
      }),
    } as MessageEvent);

    expect(screen.getAllByText('hello world')).toHaveLength(1);
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

  it('rolls back optimistic engaged agents when send fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ sendError: 500 })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), '@sarah hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText('send failed: 500')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop Sarah from listening' })).not.toBeInTheDocument();
  });

  it('clears engaged agents when bootstrap reloads', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'engaged',
          platformId: 'lobby-1',
          threadId: 'main',
          agents: ['sarah'],
        }),
      } as MessageEvent);
    });
    expect(await screen.findByRole('button', { name: 'Stop Sarah from listening' })).toBeInTheDocument();

    unmount();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    expect(screen.queryByRole('button', { name: 'Stop Sarah from listening' })).not.toBeInTheDocument();
  });

  it('ignores duplicate disengage requests while one is in flight', async () => {
    let resolveDisengage: ((value: { agents: string[] }) => void) | undefined;
    const disengageSpy = vi.spyOn(api, 'disengageAgent').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDisengage = resolve;
        }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [], engagedAgents: ['sarah'] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    const dismiss = await screen.findByRole('button', { name: 'Stop Sarah from listening' });

    await act(async () => {
      fireEvent.click(dismiss);
      fireEvent.click(dismiss);
    });
    expect(disengageSpy).toHaveBeenCalledTimes(1);

    resolveDisengage?.({ agents: [] });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Stop Sarah from listening' })).not.toBeInTheDocument();
    });
    disengageSpy.mockRestore();
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
          messagesForThread: (_platformId, threadId) => ({
            messages: threadId === 'main' ? [messageFixture] : [],
          }),
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
    expect(vi.mocked(api.createThread)).toHaveBeenCalled();
  });

  it('auto-names a thread from the first message', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    vi.mocked(api.renameThread).mockClear();

    await user.click(screen.getByRole('button', { name: 'New thread in Lobby' }));
    await screen.findByRole('button', { name: 'Thread 1' });

    await user.type(screen.getByPlaceholderText(/Message… use @folder/), 'Review the auth flow');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByRole('button', { name: 'Review the auth flow' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thread 1' })).not.toBeInTheDocument();
    expect(vi.mocked(api.renameThread)).toHaveBeenCalled();
  });

  it('renames a thread from the sidebar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              {
                platformId: 'lobby-1',
                name: 'Lobby',
                kind: 'lobby',
                threads: [
                  { id: 'main', title: 'Main' },
                  { id: 'thread_b', title: 'Thread B' },
                ],
              },
              ...bootstrapFixture.rooms.slice(1),
            ],
          },
        }),
      ),
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
    expect(vi.mocked(api.renameThread)).toHaveBeenCalledWith(
      'secret',
      'lobby-1',
      'thread_b',
      'Renamed topic',
    );
  });

  it('appends websocket messages for the active room and thread', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);

    expect(await screen.findByText('Agent reply')).toBeInTheDocument();
  });

  it('soft-merges bootstrap websocket events without leaving the active room', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'bootstrap',
          bootstrap: {
            user: bootstrapFixture.user,
            rooms: [
              ...bootstrapFixture.rooms,
              {
                platformId: 'dm:ted',
                name: 'Ted',
                kind: 'dm',
                folder: 'ted',
                threads: [{ id: 'main', title: 'Main' }],
              },
            ],
            agents: [
              ...bootstrapFixture.agents,
              { folder: 'ted', name: 'Ted', mention: '@ted' },
            ],
          },
        }),
      } as MessageEvent);
    });

    expect(await screen.findByRole('button', { name: 'Ted' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
  });

  it('leaves a deleted DM and returns to lobby when bootstrap drops the room', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'bootstrap',
          bootstrap: {
            user: bootstrapFixture.user,
            rooms: [
              ...bootstrapFixture.rooms,
              {
                platformId: 'dm:ted',
                name: 'Ted',
                kind: 'dm',
                folder: 'ted',
                threads: [{ id: 'main', title: 'Main' }],
              },
            ],
            agents: [
              ...bootstrapFixture.agents,
              { folder: 'ted', name: 'Ted', mention: '@ted' },
            ],
          },
        }),
      } as MessageEvent);
    });

    await user.click(await screen.findByRole('button', { name: 'Ted' }));
    expect(await screen.findByRole('heading', { name: 'Ted' })).toBeInTheDocument();

    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'bootstrap',
          bootstrap: {
            user: bootstrapFixture.user,
            rooms: bootstrapFixture.rooms,
            agents: bootstrapFixture.agents,
          },
        }),
      } as MessageEvent);
    });

    expect(screen.queryByRole('button', { name: 'Ted' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
  });

  it('ignores bootstrap websocket events scoped to another user', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    await act(async () => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'bootstrap',
          forUserId: 'web:basic:other',
          bootstrap: {
            user: { id: 'web:basic:other', displayName: 'Other' },
            rooms: [
              ...bootstrapFixture.rooms,
              {
                platformId: 'dm:leaked',
                name: 'Leaked',
                kind: 'dm',
                folder: 'leaked',
                threads: [{ id: 'main', title: 'Main' }],
              },
            ],
            agents: [
              ...bootstrapFixture.agents,
              { folder: 'leaked', name: 'Leaked', mention: '@leaked' },
            ],
          },
        }),
      } as MessageEvent);
    });

    expect(screen.queryByRole('button', { name: 'Leaked' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
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

    const ws = await waitForWebSocket(MockWebSocket);
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

    const ws = await waitForWebSocket(MockWebSocket);
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              {
                platformId: 'lobby-1',
                name: 'Lobby',
                kind: 'lobby',
                threads: [
                  { id: 'main', title: 'Main' },
                  { id: 'thread_b', title: 'Thread B' },
                ],
              },
              ...bootstrapFixture.rooms.slice(1),
            ],
          },
        }),
      ),
    );
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({ type: 'message', message: messageFixture }),
    } as MessageEvent);

    expect(await screen.findByRole('button', { name: 'Lobby, 1 unread message' })).toBeInTheDocument();
    expect(screen.queryByText('Agent reply')).not.toBeInTheDocument();
  });

  it('syncs unread for inactive rooms when the socket opens and on interval', async () => {
    const fetchMessagesSpy = vi.spyOn(api, 'fetchMessages');
    fetchMessagesSpy.mockImplementation(async (_token, platformId, threadId, since = 0) => {
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) {
        return { messages: [], engagedAgents: [] };
      }
      if (platformId === 'dm-sarah' && threadId === 'main') {
        return {
          messages: [
            {
              ...messageFixture,
              id: 'sync-msg',
              platformId: 'dm-sarah',
              timestamp: since + 1000,
            },
          ],
        };
      }
      if (platformId === 'lobby-2' && threadId === 'main') {
        return {
          messages: [
            {
              ...messageFixture,
              id: 'sync-lobby-2',
              platformId: 'lobby-2',
              timestamp: since + 1000,
            },
          ],
        };
      }
      return { messages: [], engagedAgents: [] };
    });

    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) {
        return { messages: [], engagedAgents: [] };
      }
      return { messages: [], engagedAgents: [] };
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
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) {
        return { messages: [], engagedAgents: [] };
      }
      return { messages: [], engagedAgents: [] };
    });

    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) {
        return { messages: [], engagedAgents: [] };
      }
      await fetchGate;
      return { messages: [], engagedAgents: [] };
    });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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

    const ws = await waitForWebSocket(MockWebSocket);
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
      if (platformId === 'lobby-1' && threadId === 'main' && since === 0) {
        return { messages: [], engagedAgents: [] };
      }
      if (platformId === 'dm-sarah') throw new Error('network');
      return { messages: [], engagedAgents: [] };
    });

    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
          messages: [messageFixture],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
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

    const ws = await waitForWebSocket(MockWebSocket);
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
    const scrollToBottom = vi.spyOn(chatScroll, 'scrollToBottom');

    render(<App />);
    await screen.findByText('Agent reply');

    expect(scrollToBottom).toHaveBeenCalled();
  });

  it('highlights active room buttons in each section', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    const roomsSection = screen.getByText('Rooms').closest('.nav-section');
    expect(roomsSection).not.toBeNull();
    const lobbyButton = within(roomsSection as HTMLElement).getByRole('button', { name: 'Lobby' });
    expect(lobbyButton.closest('.nav-room-header')).toHaveClass('active');
  });

  it('switches between lobby rooms from the sidebar', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const roomsSection = screen.getByText('Rooms').closest('.nav-section');
    const otherLobby = within(roomsSection as HTMLElement).getByRole('button', { name: 'Other Lobby' });
    expect(otherLobby.closest('.nav-room-header')).not.toHaveClass('active');

    await user.click(otherLobby);

    expect(otherLobby.closest('.nav-room-header')).toHaveClass('active');
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
    await waitFor(() => {
      expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    });
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    const lobbyButton = screen.getByRole('button', { name: 'Lobby' });
    const threadBButton = screen.getByRole('button', { name: 'Thread B' });
    expect(lobbyButton.closest('.nav-room-header')).toHaveClass('active');
    expect(threadBButton.closest('.nav-thread-row')).not.toHaveClass('active');

    await user.click(threadBButton);

    expect(lobbyButton.closest('.nav-room-header')).not.toHaveClass('active');
    expect(threadBButton.closest('.nav-thread-row')).toHaveClass('active');
  });

  it('falls back to the main thread when bootstrap threads are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [{ platformId: 'lobby-1', name: 'Lobby', kind: 'lobby', threads: [] }],
          },
        }),
      ),
    );
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
    expect(api.sendMessage).toHaveBeenCalledWith('secret', 'lobby-1', 'main', 'first', undefined);
  });

  it('sends image attachments selected through the file input', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(api.sendMessage).toHaveBeenCalledWith(
        'secret',
        'lobby-1',
        'main',
        '',
        expect.arrayContaining([
          expect.objectContaining({
            uploadId: '550e8400-e29b-41d4-a716-446655440000',
            name: 'photo.png',
            mimeType: 'image/png',
            type: 'image',
          }),
        ]),
      );
    });
  });

  it('shows an error when attachment upload fails before send', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.spyOn(attachments, 'uploadPendingAttachments').mockResolvedValue({
      uploads: [],
      failed: [{ name: 'photo.png', reason: 'upload_failed', detail: 'upload failed: 500' }],
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const file = new File(['hello'], 'photo.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });
    await waitFor(() => {
      expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('photo.png: upload failed: 500')).toBeInTheDocument();
    });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('supports composer attachment workflows', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const composer = document.querySelector('.composer-box')!;
    const markdown = new File(['# Title'], 'notes.md', { type: 'text/markdown' });
    const image = new File(['hello'], 'photo.png', { type: 'image/png' });

    fireEvent.dragOver(composer);
    expect(composer).toHaveClass('is-dragover');
    fireEvent.dragLeave(composer, { relatedTarget: document.body });
    expect(composer).not.toHaveClass('is-dragover');

    fireEvent.drop(composer, { dataTransfer: { files: [markdown] } });
    await waitFor(() => {
      expect(screen.getByText('notes.md')).toBeInTheDocument();
    });

    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [image] },
    });
    await waitFor(() => {
      expect(screen.getByAltText('photo.png')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }));
    expect(screen.queryByAltText('photo.png')).not.toBeInTheDocument();

    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Attach file' }));
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it('shows video preview in composer pending attachments', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const video = new File(['hello'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [video] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('clip.mp4')).toBeInTheDocument();
    });
    expect(document.querySelector('.composer-preview video')).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    );
    expect(document.querySelector('.composer-preview')).not.toHaveClass('composer-preview-file');
  });

  it('shows audio preview in composer pending attachments', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const audio = new File(['hello'], 'song.mp3', { type: 'audio/mpeg' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [audio] },
    });

    await waitFor(() => {
      expect(screen.getByLabelText('song.mp3')).toBeInTheDocument();
    });
    expect(document.querySelector('.composer-preview-audio audio')).toHaveAttribute(
      'src',
      expect.stringMatching(/^blob:/),
    );
    expect(document.querySelector('.composer-preview-audio')).not.toHaveClass('composer-preview-file');
  });

  it('shows text preview snippet in composer pending attachments', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const md = new File(['# Title\nbody'], 'notes.md', { type: 'text/markdown' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [md] },
    });

    await waitFor(() => {
      expect(screen.getByText('Markdown')).toBeInTheDocument();
      expect(screen.getByText('# Title')).toBeInTheDocument();
    });
    expect(document.querySelector('.composer-preview-text')).not.toBeNull();
  });

  it('shows pdf file chip styling in composer pending attachments', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const pdf = new File(['hello'], 'report.pdf', { type: 'application/pdf' });
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [pdf] },
    });

    await waitFor(() => {
      expect(screen.getByText('report.pdf')).toBeInTheDocument();
    });
    expect(document.querySelector('.composer-preview')).toHaveClass('composer-preview-file');
  });

  it('caps pending attachments when files are added concurrently', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const pending = (name: string) => ({
      file: new File(['x'], name, { type: 'text/plain' }),
      name,
      mimeType: 'text/plain',
      type: 'file' as const,
      size: 1,
      previewUrl: `blob:${name}`,
    });

    vi.spyOn(attachments, 'readAttachmentFiles')
      .mockResolvedValueOnce({
        attachments: Array.from({ length: 9 }, (_, i) => pending(`${i}.txt`)),
        rejected: [],
      })
      .mockResolvedValueOnce({
        attachments: [pending('nine.txt')],
        rejected: [{ name: 'overflow.txt', reason: 'capacity' }],
      });

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const composer = document.querySelector('.composer-box')!;
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['a'], 'a.txt')] } });
    await waitFor(() => {
      expect(document.querySelectorAll('.composer-preview')).toHaveLength(9);
    });

    fireEvent.drop(composer, { dataTransfer: { files: [new File(['c'], 'c.txt')] } });
    await waitFor(() => {
      expect(document.querySelectorAll('.composer-preview')).toHaveLength(attachments.MAX_ATTACHMENTS);
      expect(screen.getByText(/Only 10 attachments allowed \(overflow.txt skipped\)/)).toBeInTheDocument();
    });
  });

  it('revokes previews for attachments dropped during merge', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const pending = (name: string) => ({
      file: new File(['x'], name, { type: 'text/plain' }),
      name,
      mimeType: 'text/plain',
      type: 'file' as const,
      size: 1,
      previewUrl: `blob:${name}`,
    });

    vi.spyOn(attachments, 'readAttachmentFiles')
      .mockResolvedValueOnce({
        attachments: Array.from({ length: 9 }, (_, i) => pending(`${i}.txt`)),
        rejected: [],
      })
      .mockResolvedValueOnce({
        attachments: [pending('nine.txt'), pending('ten.txt')],
        rejected: [],
      });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const composer = document.querySelector('.composer-box')!;
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['a'], 'a.txt')] } });
    await waitFor(() => {
      expect(document.querySelectorAll('.composer-preview')).toHaveLength(9);
    });

    fireEvent.drop(composer, { dataTransfer: { files: [new File(['b'], 'b.txt')] } });
    await waitFor(() => {
      expect(document.querySelectorAll('.composer-preview')).toHaveLength(attachments.MAX_ATTACHMENTS);
    });
    expect(revoke).toHaveBeenCalledWith('blob:ten.txt');
  });

  it('shows an error when attachment staging fails', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.spyOn(attachments, 'readAttachmentFiles').mockRejectedValueOnce(new Error('read failed'));
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    fireEvent.drop(document.querySelector('.composer-box')!, {
      dataTransfer: { files: [new File(['x'], 'bad.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => {
      expect(screen.getByText('read failed')).toBeInTheDocument();
    });
  });

  it('ignores empty attachment drops and invalid attachment batches', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const composer = document.querySelector('.composer-box')!;
    fireEvent.drop(composer, { dataTransfer: { files: [] } });
    fireEvent.drop(composer, { dataTransfer: { files: [new File(['x'], '   ', { type: 'text/plain' })] } });
    expect(screen.queryByText('   ')).not.toBeInTheDocument();
  });

  it('shows an error when a file exceeds the size limit', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const big = new File([new Uint8Array(attachments.MAX_ATTACHMENT_BYTES + 1)], 'big.png', {
      type: 'image/png',
    });
    fireEvent.drop(document.querySelector('.composer-box')!, {
      dataTransfer: { files: [big] },
    });

    await waitFor(() => {
      expect(screen.getByText('big.png exceeds the 1 GB limit')).toBeInTheDocument();
    });
  });

  it('shows a generic attachment error for non-Error failures', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.spyOn(attachments, 'readAttachmentFiles').mockRejectedValueOnce('nope');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    fireEvent.drop(document.querySelector('.composer-box')!, {
      dataTransfer: { files: [new File(['x'], 'bad.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => {
      expect(screen.getByText('attachment failed')).toBeInTheDocument();
    });
  });

  it('shows attachment errors thrown as Error instances', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.spyOn(attachments, 'readAttachmentFiles').mockRejectedValueOnce(new Error('boom'));
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    fireEvent.drop(document.querySelector('.composer-box')!, {
      dataTransfer: { files: [new File(['x'], 'bad.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('keeps drag-over styling when leaving to a child element', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const composer = document.querySelector('.composer-box')!;
    fireEvent.dragOver(composer);
    vi.spyOn(composer, 'contains').mockReturnValue(true);
    fireEvent.dragLeave(composer, { relatedTarget: document.body });
    expect(composer).toHaveClass('is-dragover');
  });

  it('renders image attachments in message history', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) {
        return {
          ok: true,
          json: async () => ({
            messages: [
              {
                id: 'msg-img',
                direction: 'outbound',
                text: '',
                timestamp: 1_700_000_000_000,
                platformId: 'lobby-1',
                threadId: 'main',
                attachments: [
                  {
                    name: 'chart.png',
                    mimeType: 'image/png',
                    type: 'image',
                    data: 'aGVsbG8=',
                  },
                ],
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          user: { id: 'u1', displayName: 'Test User' },
          rooms: [{ platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' }],
          agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
        }),
      } as Response;
    });

    const { container } = render(<App />);
    const button = await screen.findByRole('button', { name: 'View chart.png' });
    expect(button).toHaveClass('msg-attachment-image');
    expect(container.querySelector('.msg-attachment-image img')).toHaveAttribute(
      'src',
      'data:image/png;base64,aGVsbG8=',
    );
    fireEvent.click(button);
    expect(screen.getByLabelText('Attachment preview: chart.png')).toBeInTheDocument();
  });

  it('renders video attachments in message history and opens drawer', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) {
        return {
          ok: true,
          json: async () => ({
            messages: [
              {
                id: 'msg-vid',
                direction: 'outbound',
                text: '',
                timestamp: 1_700_000_000_000,
                platformId: 'lobby-1',
                threadId: 'main',
                attachments: [
                  {
                    name: 'clip.mp4',
                    mimeType: 'video/mp4',
                    type: 'file',
                    data: 'aGVsbG8=',
                  },
                ],
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          user: { id: 'u1', displayName: 'Test User' },
          rooms: [{ platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' }],
          agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
        }),
      } as Response;
    });

    const { container } = render(<App />);
    const button = await screen.findByRole('button', { name: 'View clip.mp4' });
    expect(button).toHaveClass('msg-attachment-video');
    expect(container.querySelector('.msg-attachment-video video')).toHaveAttribute(
      'src',
      'data:video/mp4;base64,aGVsbG8=',
    );
    fireEvent.click(button);
    expect(screen.getByLabelText('Attachment preview: clip.mp4')).toBeInTheDocument();
    expect(container.querySelector('.attachment-drawer-video')).toHaveAttribute(
      'src',
      'data:video/mp4;base64,aGVsbG8=',
    );
  });

  it('renders audio attachments in message history and opens drawer', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/messages')) {
        return {
          ok: true,
          json: async () => ({
            messages: [
              {
                id: 'msg-aud',
                direction: 'outbound',
                text: '',
                timestamp: 1_700_000_000_000,
                platformId: 'lobby-1',
                threadId: 'main',
                attachments: [
                  {
                    name: 'song.mp3',
                    mimeType: 'audio/mpeg',
                    type: 'file',
                    data: 'aGVsbG8=',
                  },
                ],
              },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          user: { id: 'u1', displayName: 'Test User' },
          rooms: [{ platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' }],
          agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
        }),
      } as Response;
    });

    const { container } = render(<App />);
    const button = await screen.findByRole('button', { name: 'View song.mp3' });
    expect(button).toHaveClass('msg-attachment-audio-title');
    expect(container.querySelector('.msg-attachment-audio audio')).toHaveAttribute(
      'src',
      'data:audio/mpeg;base64,aGVsbG8=',
    );
    fireEvent.click(button);
    expect(screen.getByLabelText('Attachment preview: song.mp3')).toBeInTheDocument();
    expect(container.querySelector('.attachment-drawer-audio')).toHaveAttribute(
      'src',
      'data:audio/mpeg;base64,aGVsbG8=',
    );
  });

  it('deletes a thread from the sidebar and returns to main', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Thread B' }));
    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(screen.queryByRole('button', { name: 'Thread B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lobby' }).closest('.nav-room-header')).toHaveClass('active');
    expect(vi.mocked(api.deleteThread)).toHaveBeenCalledWith('secret', 'lobby-1', 'thread_b');
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
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
    expect(vi.mocked(api.renameThread)).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    await user.clear(screen.getByLabelText('Thread name'));
    await user.type(screen.getByLabelText('Thread name'), '   {Enter}');

    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();
  });

  it('deletes a child thread while viewing the room main thread', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(screen.queryByRole('button', { name: 'Thread B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lobby' }).closest('.nav-room-header')).toHaveClass('active');
    expect(screen.getByRole('heading', { name: 'Lobby' })).toBeInTheDocument();
  });

  it('deletes a thread in another room without changing the active view', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
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
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'custom-thread', title: 'Custom topic' },
          ]),
        }),
      ),
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

  it('migrates legacy localStorage threads when the server only has main', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([
        { id: 'main', title: 'Main' },
        { id: 'thread_legacy', title: 'Legacy topic' },
      ]),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Legacy topic' })).toBeInTheDocument();
    expect(vi.mocked(api.createThread)).toHaveBeenCalledWith('secret', 'lobby-1', 'Legacy topic');
    expect(localStorage.getItem('webchat_threads:lobby-1')).toBeNull();
  });

  it('shows an error when create thread fails', async () => {
    vi.mocked(api.createThread).mockRejectedValueOnce(new Error('create thread failed: 500'));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.click(screen.getByRole('button', { name: 'New thread in Lobby' }));

    expect(await screen.findByText('create thread failed: 500')).toBeInTheDocument();
  });

  it('shows a generic error when create thread fails with a non-Error value', async () => {
    vi.mocked(api.createThread).mockRejectedValueOnce('network down');
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    await user.click(screen.getByRole('button', { name: 'New thread in Lobby' }));

    expect(await screen.findByText('create thread failed')).toBeInTheDocument();
  });

  it('shows an error when rename thread fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    vi.mocked(api.renameThread).mockRejectedValueOnce(new Error('rename thread failed: 403'));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    const renameInput = screen.getByLabelText('Thread name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed topic{Enter}');

    expect(await screen.findByText('rename thread failed: 403')).toBeInTheDocument();
  });

  it('shows a generic error when rename thread fails with a non-Error value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    vi.mocked(api.renameThread).mockRejectedValueOnce('network down');
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Rename Thread B' }));
    const renameInput = screen.getByLabelText('Thread name');
    await user.clear(renameInput);
    await user.type(renameInput, 'Renamed topic{Enter}');

    expect(await screen.findByText('rename thread failed')).toBeInTheDocument();
  });

  it('shows an error when delete thread fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    vi.mocked(api.deleteThread).mockRejectedValueOnce(new Error('delete thread failed: 404'));
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(await screen.findByText('delete thread failed: 404')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Thread B' })).toBeInTheDocument();
  });

  it('shows a generic error when delete thread fails with a non-Error value', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    vi.mocked(api.deleteThread).mockRejectedValueOnce('network down');
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Thread B' });

    await user.click(screen.getByRole('button', { name: 'Delete Thread B' }));

    expect(await screen.findByText('delete thread failed')).toBeInTheDocument();
  });

  it('migrates remaining legacy threads when the server already has child threads', async () => {
    localStorage.setItem(
      'webchat_threads:lobby-1',
      JSON.stringify([{ id: 'thread_legacy', title: 'Legacy topic' }]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: bootstrapWithLobbyThreads([
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ]),
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Legacy topic' })).toBeInTheDocument();
    expect(vi.mocked(api.createThread)).toHaveBeenCalledWith('secret', 'lobby-1', 'Legacy topic');
    expect(localStorage.getItem('webchat_threads:lobby-1')).toBeNull();
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

  it('opens and closes the attachment drawer from message history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            {
              ...messageFixture,
              text: '',
              attachments: [
                {
                  name: 'photo.png',
                  mimeType: 'image/png',
                  type: 'image',
                  data: 'aGVsbG8=',
                },
              ],
            },
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    fireEvent.click(await screen.findByRole('button', { name: 'View photo.png' }));
    expect(screen.getByLabelText('Attachment preview: photo.png')).toBeInTheDocument();
    expect(document.querySelector('.main--drawer-open')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close attachment preview' }));
    expect(screen.queryByLabelText('Attachment preview: photo.png')).not.toBeInTheDocument();
    expect(document.querySelector('.main--drawer-open')).not.toBeInTheDocument();
  });

  it('closes the attachment drawer when switching rooms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messagesForThread: (platformId) => ({
            messages:
              platformId === 'lobby-1'
                ? [
                    {
                      ...messageFixture,
                      text: '',
                      attachments: [
                        {
                          name: 'photo.png',
                          mimeType: 'image/png',
                          type: 'image',
                          data: 'aGVsbG8=',
                        },
                      ],
                    },
                  ]
                : [],
          }),
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    fireEvent.click(await screen.findByRole('button', { name: 'View photo.png' }));
    expect(screen.getByLabelText('Attachment preview: photo.png')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sarah' }));
    expect(await screen.findByRole('heading', { name: 'Sarah' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Attachment preview: photo.png')).not.toBeInTheDocument();
    expect(document.querySelector('.main--drawer-open')).not.toBeInTheDocument();
  });

  it('hides and shows the sidebar', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    await user.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(document.querySelector('.layout--sidebar-collapsed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(document.querySelector('.layout--sidebar-collapsed')).not.toBeInTheDocument();
  });

  it('resizes the sidebar with keyboard and pointer drag', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(localStorage.getItem('webchat_sidebar_width')).toBe('240');

    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1, buttons: 1 });
    handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 350, pointerId: 1, bubbles: true }));
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 350, pointerId: 1, bubbles: true }));

    expect(localStorage.getItem('webchat_sidebar_width')).toBe('290');
    expect(document.body.classList.contains('sidebar-resizing')).toBe(false);
  });

  it('coalesces resize layout updates with requestAnimationFrame', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(42);
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    fireEvent(window, new Event('resize'));
    fireEvent(window, new Event('resize'));
    expect(cancelSpy).toHaveBeenCalledWith(42);

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
  });

  it('cancels pending resize frame on unmount', async () => {
    sessionStorage.setItem('webchat_token', 'secret');
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(99);
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });
    fireEvent(window, new Event('resize'));
    unmount();
    expect(cancelSpy).toHaveBeenCalledWith(99);
    cancelSpy.mockRestore();
  });

  it('reverts sidebar width when a drag is cancelled after movement', async () => {
    localStorage.setItem('webchat_sidebar_width', '290');
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    const layout = document.querySelector('.layout') as HTMLElement;
    await waitFor(() => {
      expect(layout.style.getPropertyValue('--sidebar-width')).toBe('290px');
    });

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();

    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 2, buttons: 1 });
    await act(async () => {
      handle.dispatchEvent(new PointerEvent('pointermove', { clientX: 350, pointerId: 2, bubbles: true }));
    });
    expect(layout.style.getPropertyValue('--sidebar-width')).toBe('340px');
    await act(async () => {
      handle.dispatchEvent(new PointerEvent('pointercancel', { clientX: 350, pointerId: 2, bubbles: true }));
    });
    expect(document.body.classList.contains('sidebar-resizing')).toBe(false);
    expect(localStorage.getItem('webchat_sidebar_width')).toBe('290');
    expect(layout.style.getPropertyValue('--sidebar-width')).toBe('290px');
  });

  it('clamps sidebar width on window resize and tracks manual message scroll', async () => {
    localStorage.setItem('webchat_sidebar_width', '400');
    sessionStorage.setItem('webchat_token', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    render(<App />);
    await screen.findByText('Agent reply');

    const layout = document.querySelector('.layout') as HTMLElement;
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    fireEvent(window, new Event('resize'));
    await waitFor(() => {
      expect(layout.style.getPropertyValue('--sidebar-width')).toBe('200px');
    });

    const messages = document.querySelector('.messages') as HTMLDivElement;
    Object.defineProperty(messages, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(messages, 'clientHeight', { value: 400, configurable: true });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);
    messages.scrollTop = 950;
    fireEvent.scroll(messages);
  });

  it('does not auto-scroll when the user has scrolled away from the bottom', async () => {
    const scrollToBottom = vi.spyOn(chatScroll, 'scrollToBottom');
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [messageFixture] })),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByText('Agent reply');
    scrollToBottom.mockClear();

    const messages = document.querySelector('.messages') as HTMLDivElement;
    Object.defineProperty(messages, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(messages, 'clientHeight', { value: 400, configurable: true });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, id: 'msg-2', text: 'another reply' },
      }),
    } as MessageEvent);

    await screen.findByText('another reply');
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it('anchors scroll to unread messages when opening a channel with unread', async () => {
    const scrollToUnreadAnchor = vi.spyOn(chatScroll, 'scrollToUnreadAnchor');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            { ...messageFixture, id: 'msg-1', text: 'older' },
            { ...messageFixture, id: 'msg-2', text: 'newer' },
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message',
        message: { ...messageFixture, id: 'msg-dm', platformId: 'dm-sarah', text: 'dm ping' },
      }),
    } as MessageEvent);

    await user.click(screen.getByRole('button', { name: 'Sarah' }));
    await screen.findByText('newer');

    expect(scrollToUnreadAnchor).toHaveBeenCalled();
  });

  it('rebalances panel widths when the window narrows with all panels open', async () => {
    localStorage.setItem('webchat_sidebar_width', '240');
    localStorage.setItem('webchat_attachment_drawer_width', '480');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1500, writable: true });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            {
              ...messageFixture,
              text: '',
              attachments: [
                {
                  name: 'photo.png',
                  mimeType: 'image/png',
                  type: 'image',
                  data: 'aGVsbG8=',
                },
              ],
            },
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    fireEvent.click(await screen.findByRole('button', { name: 'View photo.png' }));

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900, writable: true });
    fireEvent(window, new Event('resize'));

    const layout = document.querySelector('.layout') as HTMLElement;
    const drawer = document.querySelector('.attachment-drawer') as HTMLElement;
    await waitFor(() => {
      expect(layout.style.getPropertyValue('--sidebar-width')).toBe('240px');
      expect(drawer.style.width).toBe('268px');
    });
  });

  it('clamps attachment drawer width from the main layout when resized', async () => {
    localStorage.setItem('webchat_sidebar_width', '220');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            {
              ...messageFixture,
              text: '',
              attachments: [
                {
                  name: 'photo.png',
                  mimeType: 'image/png',
                  type: 'image',
                  data: 'aGVsbG8=',
                },
              ],
            },
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    render(<App />);
    await screen.findByRole('heading', { name: 'NanoClaw' });

    fireEvent.click(await screen.findByRole('button', { name: 'View photo.png' }));
    const handle = screen.getByRole('separator', { name: 'Resize attachment preview' });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 1, buttons: 1 });
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, pointerId: 1, bubbles: true }));

    expect(localStorage.getItem('webchat_attachment_drawer_width')).not.toBe('900');
  });

  it('clamps attachment drawer width when the sidebar is collapsed', async () => {
    localStorage.setItem('webchat_sidebar_collapsed', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [
            {
              ...messageFixture,
              text: '',
              attachments: [
                {
                  name: 'photo.png',
                  mimeType: 'image/png',
                  type: 'image',
                  data: 'aGVsbG8=',
                },
              ],
            },
          ],
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    fireEvent.click(await screen.findByRole('button', { name: 'View photo.png' }));
    const handle = screen.getByRole('separator', { name: 'Resize attachment preview' });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    fireEvent.pointerDown(handle, { clientX: 900, pointerId: 2, buttons: 1 });
    handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, pointerId: 2, bubbles: true }));

    expect(localStorage.getItem('webchat_attachment_drawer_width')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show sidebar' }));
    expect(document.querySelector('.layout--sidebar-collapsed')).not.toBeInTheDocument();
  });

  it('applies message_update websocket events to interactive cards', async () => {
    const cardMessage: WebChatMessage = {
      ...messageFixture,
      id: 'card-1',
      platformId: 'inbox',
      text: 'Approve MCP',
      card: {
        type: 'ask_question',
        questionId: 'q-1',
        title: 'MCP',
        question: 'Add server?',
        options: [{ label: 'Approve', value: 'approve' }],
        status: 'pending',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              { platformId: 'inbox', name: 'Inbox', kind: 'inbox', threads: [...defaultThreads] },
              ...bootstrapFixture.rooms,
            ],
          },
          messagesForThread: (platformId, threadId) => {
            if (platformId === 'inbox' && threadId === 'main') {
              return { messages: [cardMessage] };
            }
            return { messages: [] };
          },
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Inbox' }));
    await screen.findByRole('button', { name: 'Approve' });

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message_update',
        message: {
          ...cardMessage,
          card: {
            ...cardMessage.card!,
            status: 'answered',
            selectedLabel: 'Approved',
            selectedValue: 'approve',
          },
        },
      }),
    } as MessageEvent);

    await screen.findByText('Approved');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('ignores message_update events for inactive conversations', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({})));
    sessionStorage.setItem('webchat_token', 'secret');
    const MockWebSocket = createWebSocketMock();
    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    const ws = await waitForWebSocket(MockWebSocket);
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'message_update',
        message: {
          ...messageFixture,
          id: 'card-other',
          platformId: 'inbox',
          threadId: 'main',
          card: {
            type: 'ask_question',
            questionId: 'q-other',
            title: 'Other',
            question: 'Other?',
            options: [{ label: 'Yes', value: 'yes' }],
            status: 'answered',
            selectedLabel: 'Yes',
          },
        },
      }),
    } as MessageEvent);

    expect(screen.queryByText('Yes')).not.toBeInTheDocument();
  });

  it('shows inbox hint instead of composer in inbox room', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              { platformId: 'inbox', name: 'Inbox', kind: 'inbox', threads: [...defaultThreads] },
              ...bootstrapFixture.rooms,
            ],
          },
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Inbox' }));
    expect(
      screen.getByText(/Approvals and system notifications appear here/),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Message… use @folder/)).not.toBeInTheDocument();
  });

  it('updates message state when an interactive card action succeeds', async () => {
    const cardMessage: WebChatMessage = {
      ...messageFixture,
      id: 'card-2',
      platformId: 'inbox',
      text: 'Approve MCP',
      card: {
        type: 'ask_question',
        questionId: 'q-2',
        title: 'MCP',
        question: 'Add server?',
        options: [{ label: 'Approve', selectedLabel: 'Approved', value: 'approve' }],
        status: 'pending',
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          bootstrap: {
            ...bootstrapFixture,
            rooms: [
              { platformId: 'inbox', name: 'Inbox', kind: 'inbox', threads: [...defaultThreads] },
              ...bootstrapFixture.rooms,
            ],
          },
          messagesForThread: (platformId, threadId) => {
            if (platformId === 'inbox' && threadId === 'main') {
              return { messages: [cardMessage] };
            }
            return { messages: [] };
          },
        }),
      ),
    );
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Inbox' }));
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await screen.findByText('Approved');
  });

  it('renders live activity from websocket and clears on activity_clear', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    const ws = await waitForWebSocket(MockWebSocket);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity',
          platformId: 'lobby-1',
          threadId: 'main',
          event: {
            turnId: 't-live',
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: 'tool_start',
            summary: 'Running Bash',
            tool: 'Bash',
            agentName: 'Sarah',
            agentFolder: 'sarah',
          },
        }),
      } as MessageEvent);
    });

    expect(await screen.findByText('Running Bash')).toBeInTheDocument();

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity_clear',
          platformId: 'lobby-1',
          threadId: 'main',
          turnId: 't-live',
        }),
      } as MessageEvent);
    });

    await waitFor(() => {
      expect(screen.queryByText('Running Bash')).not.toBeInTheDocument();
    });
  });

  it('replays activity from GET /activity on room load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        createFetchMock({
          messages: [],
          activity: [
            {
              turnId: 't-replay',
              seq: 1,
              timestamp: new Date().toISOString(),
              kind: 'tool_start',
              summary: 'Replayed Grep',
              tool: 'Grep',
              agentName: 'Sarah',
              agentFolder: 'sarah',
            },
          ],
        }),
      ),
    );
    createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    expect(await screen.findByText('Replayed Grep')).toBeInTheDocument();
  });

  it('ticks the live-status prune interval while activity is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
      const MockWebSocket = createWebSocketMock();
      sessionStorage.setItem('webchat_token', 'secret');

      render(<App />);
      await screen.findByRole('heading', { name: 'Lobby' });
      const ws = await waitForWebSocket(MockWebSocket);

      act(() => {
        ws.onmessage?.({
          data: JSON.stringify({
            type: 'activity',
            platformId: 'lobby-1',
            threadId: 'main',
            event: {
              turnId: 't-tick',
              seq: 1,
              timestamp: new Date().toISOString(),
              kind: 'tool_start',
              summary: 'Ticking Bash',
              tool: 'Bash',
              agentName: 'Sarah',
              agentFolder: 'sarah',
            },
          }),
        } as MessageEvent);
      });

      expect(await screen.findByText('Ticking Bash')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(450);
      });

      expect(screen.getByText('Ticking Bash')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies typing websocket events for engaged agents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(createFetchMock({ messages: [], engagedAgents: ['sarah'] })),
    );
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    const ws = await waitForWebSocket(MockWebSocket);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'typing',
          platformId: 'lobby-1',
          threadId: 'main',
          agents: ['sarah'],
        }),
      } as MessageEvent);
    });

    expect(await screen.findByLabelText('Sarah is working')).toBeInTheDocument();
  });

  it('ignores typing/activity for other rooms and unknown ws event kinds', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    const ws = await waitForWebSocket(MockWebSocket);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'typing',
          platformId: 'other-room',
          threadId: 'main',
          agents: ['sarah'],
        }),
      } as MessageEvent);
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity',
          platformId: 'other-room',
          threadId: 'main',
          event: {
            turnId: 't-x',
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: 'tool_start',
            summary: 'Other room tool',
            tool: 'Bash',
            agentName: 'Sarah',
            agentFolder: 'sarah',
          },
        }),
      } as MessageEvent);
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity_clear',
          platformId: 'other-room',
          threadId: 'main',
          turnId: 't-x',
        }),
      } as MessageEvent);
      ws.onmessage?.({
        data: JSON.stringify({ type: 'pong' }),
      } as MessageEvent);
    });

    expect(screen.queryByText('Other room tool')).not.toBeInTheDocument();
  });

  it('renders thinking live icon and invalid activity timestamps', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    const ws = await waitForWebSocket(MockWebSocket);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity',
          platformId: 'lobby-1',
          threadId: 'main',
          event: {
            turnId: 't-think',
            seq: 1,
            timestamp: 'not-a-date',
            kind: 'reasoning_summary',
            summary: 'Considering options',
            agentName: 'Sarah',
            agentFolder: 'sarah',
          },
        }),
      } as MessageEvent);
    });

    expect(await screen.findByText('Considering options')).toBeInTheDocument();
  });

  it('collapses long thinking activity behind a one-line preview with expand toggle', async () => {
    vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
    const MockWebSocket = createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');
    const user = userEvent.setup();

    render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });
    const ws = await waitForWebSocket(MockWebSocket);

    const longThinking = `First I will inspect the codebase. ${'Then I will consider every edge case in detail before writing anything. '.repeat(6)}`.trim();
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity',
          platformId: 'lobby-1',
          threadId: 'main',
          event: {
            turnId: 't-collapse',
            seq: 1,
            timestamp: new Date().toISOString(),
            kind: 'reasoning_summary',
            summary: longThinking,
            agentName: 'Sarah',
            agentFolder: 'sarah',
          },
        }),
      } as MessageEvent);
    });

    // Collapsed: one-line preview + toggle, full text hidden.
    const toggle = await screen.findByRole('button', { name: 'Show more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls');
    const controlledId = toggle.getAttribute('aria-controls')!;
    expect(document.getElementById(controlledId)).toBeTruthy();
    expect(screen.getByText('First I will inspect the codebase.')).toBeInTheDocument();
    expect(screen.queryByText(longThinking)).not.toBeInTheDocument();

    // Expand: full text visible, toggle flips, aria-controls still points at the text.
    await user.click(toggle);
    expect(screen.getByText(longThinking)).toBeInTheDocument();
    const collapseToggle = screen.getByRole('button', { name: 'Show less' });
    expect(collapseToggle).toHaveAttribute('aria-expanded', 'true');
    expect(collapseToggle).toHaveAttribute('aria-controls', controlledId);
    expect(document.getElementById(controlledId)?.textContent).toBe(longThinking);

    // Collapse again.
    await user.click(collapseToggle);
    expect(screen.queryByText(longThinking)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();

    // Re-expand; a same-turn update should keep the expanded state (prune keeps live keys).
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    const updatedThinking = `First I will inspect the codebase. ${'And then I will dig into every edge case once more carefully. '.repeat(6)}`.trim();
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity',
          platformId: 'lobby-1',
          threadId: 'main',
          event: {
            turnId: 't-collapse',
            seq: 2,
            timestamp: new Date().toISOString(),
            kind: 'reasoning_summary',
            summary: updatedThinking,
            agentName: 'Sarah',
            agentFolder: 'sarah',
          },
        }),
      } as MessageEvent);
    });
    expect(await screen.findByText(updatedThinking)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();

    // Clear the turn — expand key should prune with the live row.
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: 'activity_clear',
          platformId: 'lobby-1',
          threadId: 'main',
          turnId: 't-collapse',
        }),
      } as MessageEvent);
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });
  });

  it('renders markdown partial_text and plain generic activity after typing expires', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.stubGlobal('fetch', vi.fn(createFetchMock({ messages: [] })));
      const MockWebSocket = createWebSocketMock();
      sessionStorage.setItem('webchat_token', 'secret');

      render(<App />);
      await screen.findByRole('heading', { name: 'Lobby' });
      const ws = await waitForWebSocket(MockWebSocket);

      act(() => {
        ws.onmessage?.({
          data: JSON.stringify({
            type: 'activity',
            platformId: 'lobby-1',
            threadId: 'main',
            event: {
              turnId: 't-md',
              seq: 1,
              timestamp: new Date().toISOString(),
              kind: 'partial_text',
              summary: 'Hello **world**',
              agentName: 'Sarah',
              agentFolder: 'sarah',
            },
          }),
        } as MessageEvent);
      });

      expect(await screen.findByText('world')).toBeInTheDocument();
      expect(document.querySelector('.formatted-message--live')).toBeTruthy();

      act(() => {
        ws.onmessage?.({
          data: JSON.stringify({
            type: 'activity',
            platformId: 'lobby-1',
            threadId: 'main',
            event: {
              turnId: 't-msg',
              seq: 3,
              timestamp: new Date().toISOString(),
              kind: 'task_progress',
              summary: '<message>Tagged message</message>',
              agentName: 'Sarah',
              agentFolder: 'sarah',
            },
          }),
        } as MessageEvent);
      });

      expect(await screen.findByText('Tagged message')).toBeInTheDocument();
      expect(document.querySelector('.msg-live-activity-icon')).toBeTruthy();

      act(() => {
        ws.onmessage?.({
          data: JSON.stringify({
            type: 'activity',
            platformId: 'lobby-1',
            threadId: 'main',
            event: {
              turnId: 't-gen',
              seq: 2,
              timestamp: new Date().toISOString(),
              kind: 'task_progress',
              summary: 'Standing by',
              agentName: 'Diego',
              agentFolder: 'diego',
            },
          }),
        } as MessageEvent);
      });

      expect(await screen.findByText('Standing by')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(screen.getByText('Standing by')).toBeInTheDocument();
      const diegoRow = screen.getByLabelText('Diego is working');
      expect(diegoRow.querySelector('.typing-bubble')).toBeNull();
      expect(diegoRow.querySelector('.msg-live-activity-icon')).toBeTruthy();
      expect(diegoRow.querySelector('.formatted-message--live, .msg-live-activity-text')).toBeTruthy();

      // Generic (non-message) activity: text without a dedicated icon.
      act(() => {
        ws.onmessage?.({
          data: JSON.stringify({
            type: 'activity',
            platformId: 'lobby-1',
            threadId: 'main',
            event: {
              turnId: 't-plain',
              seq: 4,
              timestamp: new Date().toISOString(),
              kind: 'turn_start',
              summary: 'hello there',
              agentName: 'Alex',
              agentFolder: 'alex',
            },
          }),
        } as MessageEvent);
      });

      expect(await screen.findByText('hello there')).toBeInTheDocument();
      const alexRow = screen.getByLabelText('Alex is working');
      expect(alexRow.querySelector('.msg-live-activity-icon')).toBeNull();
      expect(alexRow.querySelector('.msg-live-activity-text')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores activity replay when the room effect is cancelled', async () => {
    let resolveActivity: ((value: Response) => void) | undefined;
    const activityPromise = new Promise<Response>((resolve) => {
      resolveActivity = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/activity')) {
          return activityPromise;
        }
        return createFetchMock({ messages: [] })(input);
      }),
    );
    createWebSocketMock();
    sessionStorage.setItem('webchat_token', 'secret');

    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Lobby' });

    unmount();
    resolveActivity?.(
      new Response(
        JSON.stringify({
          platformId: 'lobby-1',
          threadId: 'main',
          events: [
            {
              turnId: 't-cancel',
              seq: 1,
              timestamp: new Date().toISOString(),
              kind: 'tool_start',
              summary: 'Should not appear',
              tool: 'Bash',
              agentName: 'Sarah',
              agentFolder: 'sarah',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText('Should not appear')).not.toBeInTheDocument();
  });
});

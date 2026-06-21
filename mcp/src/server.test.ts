import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wireWebchatTools, createWebchatMcpServer, webchatLog } from './server.js';
import { WebchatClient } from './client.js';
import type { BootstrapPayload, WebChatMessage } from './types.js';
import type { ToolDeps } from './handlers.js';

const bootstrapFixture: BootstrapPayload = {
  user: { id: 'web:local', displayName: 'Local' },
  rooms: [{ platformId: 'lobby', name: 'Lobby', kind: 'lobby', threads: [{ id: 'main', title: 'Main' }] }],
  agents: [{ folder: 'sarah', name: 'Sarah', mention: '@sarah' }],
};

const messageFixture: WebChatMessage = {
  id: 'web-1',
  direction: 'outbound',
  text: 'Reply',
  timestamp: 1710000000000,
  platformId: 'lobby',
  threadId: 'main',
};

function mockClient(): WebchatClient {
  return {
    fetchBootstrap: vi.fn().mockResolvedValue(bootstrapFixture),
    fetchMessages: vi.fn().mockResolvedValue({ messages: [messageFixture], engagedAgents: [] }),
    sendMessage: vi.fn().mockResolvedValue({ messageId: 'web-99', timestamp: 1710000000001 }),
    createThread: vi.fn().mockResolvedValue({ id: 'thread_new', title: 'Task' }),
  } as unknown as WebchatClient;
}

describe('wireWebchatTools', () => {
  let handlerMap: Record<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>;
  let deps: ToolDeps;

  beforeEach(() => {
    handlerMap = {};
    deps = { client: mockClient(), log: vi.fn() };
    const server = {
      tool: vi.fn((name, _desc, _schema, handler) => {
        handlerMap[name] = handler;
      }),
    };
    wireWebchatTools(server as unknown as McpServer, deps);
    expect(Object.keys(handlerMap)).toHaveLength(7);
  });

  it('invokes all registered tool handlers', async () => {
    expect((await handlerMap.webchat_list_channels!({ query: 'lobby' })).content[0]!.text).toContain('Lobby');
    expect((await handlerMap.webchat_list_agents!({ query: 'sarah' })).content[0]!.text).toContain('Sarah');
    expect(
      (await handlerMap.webchat_read_channel!({ platformId: 'lobby', limit: 10, since: 1000 })).content[0]!.text,
    ).toContain('Reply');
    expect(
      (await handlerMap.webchat_read_thread!({ platformId: 'lobby', threadId: 'main', limit: 10, since: 1000 }))
        .content[0]!.text,
    ).toContain('Reply');
    expect(
      (await handlerMap.webchat_send_message!({ platformId: 'lobby', message: 'hi', threadId: 'main' })).content[0]!
        .text,
    ).toContain('web-99');
    expect((await handlerMap.webchat_create_thread!({ platformId: 'lobby', title: 'Task' })).content[0]!.text).toContain(
      'thread_new',
    );
    expect((await handlerMap.webchat_list_threads!({ platformId: 'lobby' })).content[0]!.text).toContain('Main');
  });
});

describe('createWebchatMcpServer', () => {
  it('creates server with default deps', () => {
    const server = createWebchatMcpServer({
      config: {
        apiBase: 'http://127.0.0.1:3200',
        secret: 'secret',
        requestTimeoutMs: 30_000,
      },
    });
    expect(server).toBeDefined();
  });

  it('webchatLog writes to stderr', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    webchatLog('hello');
    expect(spy).toHaveBeenCalledWith('[webchat-mcp] hello');
    spy.mockRestore();
  });
});

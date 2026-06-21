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
  let handlers: Array<(args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>;
  let deps: ToolDeps;

  beforeEach(() => {
    handlers = [];
    deps = { client: mockClient(), log: vi.fn() };
    const server = {
      tool: vi.fn((_name, _desc, _schema, handler) => {
        handlers.push(handler);
      }),
    };
    wireWebchatTools(server as unknown as McpServer, deps);
    expect(handlers).toHaveLength(7);
  });

  it('invokes all registered tool handlers', async () => {
    expect((await handlers[0]!({ query: 'lobby' })).content[0]!.text).toContain('Lobby');
    expect((await handlers[1]!({ query: 'sarah' })).content[0]!.text).toContain('Sarah');
    expect((await handlers[2]!({ platformId: 'lobby', limit: 10, since: 1000 })).content[0]!.text).toContain(
      'Reply',
    );
    expect(
      (await handlers[3]!({ platformId: 'lobby', threadId: 'main', limit: 10, since: 1000 })).content[0]!.text,
    ).toContain('Reply');
    expect(
      (await handlers[4]!({ platformId: 'lobby', message: 'hi', threadId: 'main' })).content[0]!.text,
    ).toContain('web-99');
    expect((await handlers[5]!({ platformId: 'lobby', title: 'Task' })).content[0]!.text).toContain(
      'thread_new',
    );
    expect((await handlers[6]!({ platformId: 'lobby' })).content[0]!.text).toContain('Main');
  });
});

describe('createWebchatMcpServer', () => {
  it('creates server with default deps', () => {
    const server = createWebchatMcpServer({
      config: {
        apiBase: 'http://127.0.0.1:3200',
        secret: 'secret',
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

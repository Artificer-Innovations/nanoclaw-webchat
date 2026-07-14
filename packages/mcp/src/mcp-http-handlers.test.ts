import { describe, it, expect, vi } from 'vitest';

import { createMcpHttpHandlers } from './mcp-http-handlers.js';

const INIT_BODY = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0.0' },
  },
};

function mockRes() {
  const res = {
    headersSent: false,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: string) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('createMcpHttpHandlers', () => {
  it('initializes a new MCP session with bearer auth', async () => {
    const handleRequest = vi.fn(async () => undefined);
    const connect = vi.fn(async () => undefined);
    const transport = {
      sessionId: 'sess-1',
      onclose: undefined as (() => void) | undefined,
      handleRequest,
    };
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: ({ onsessioninitialized, onclose }) => {
          onsessioninitialized('sess-1');
          transport.onclose = onclose;
          return transport as never;
        },
        createClient: vi.fn(() => ({}) as never),
        createServer: vi.fn(() => ({ connect }) as never),
      },
    );

    const res = mockRes();
    await mcpPostHandler(
      { headers: {}, body: INIT_BODY, auth: { token: 'user-token' } } as never,
      res as never,
    );

    expect(connect).toHaveBeenCalled();
    expect(handleRequest).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });

  it('returns 401 when initialize lacks auth token', async () => {
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: vi.fn(),
        createClient: vi.fn(),
        createServer: vi.fn(),
      },
    );
    const res = mockRes();
    await mcpPostHandler({ headers: {}, body: INIT_BODY } as never, res as never);
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for invalid session requests', async () => {
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: vi.fn(),
        createClient: vi.fn(),
        createServer: vi.fn(),
      },
    );
    const res = mockRes();
    await mcpPostHandler(
      { headers: { 'mcp-session-id': 'missing' }, body: { jsonrpc: '2.0', method: 'ping', id: 2 } } as never,
      res as never,
    );
    expect(res.statusCode).toBe(400);
  });

  it('reuses an existing transport for follow-up POSTs', async () => {
    const handleRequest = vi.fn(async () => undefined);
    const transport = { sessionId: 'sess-1', handleRequest };
    const { mcpPostHandler, transports } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: vi.fn(),
        createClient: vi.fn(),
        createServer: vi.fn(),
      },
    );
    transports['sess-1'] = transport as never;
    const res = mockRes();
    await mcpPostHandler(
      {
        headers: { 'mcp-session-id': 'sess-1' },
        body: { jsonrpc: '2.0', method: 'ping', id: 2 },
      } as never,
      res as never,
    );
    expect(handleRequest).toHaveBeenCalled();
  });

  it('handles valid stream session', async () => {
    const handleRequest = vi.fn(async () => undefined);
    const { mcpStreamHandler, transports } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: vi.fn(),
        createClient: vi.fn(),
        createServer: vi.fn(),
      },
    );
    transports.s1 = { handleRequest } as never;
    await mcpStreamHandler(
      { headers: { 'mcp-session-id': 's1' } } as never,
      mockRes() as never,
    );
    expect(handleRequest).toHaveBeenCalled();
  });

  it('registers transport after async session initialization', async () => {
    let capturedOnclose: (() => void) | undefined;
    const { mcpPostHandler, transports } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: ({ onsessioninitialized, onclose }) => {
          capturedOnclose = onclose;
          const t = { sessionId: 'sess-async', handleRequest: vi.fn() };
          queueMicrotask(() => onsessioninitialized('sess-async'));
          return t as never;
        },
        createClient: vi.fn(() => ({}) as never),
        createServer: vi.fn(() => ({ connect: vi.fn() }) as never),
      },
    );

    await mcpPostHandler(
      { headers: {}, body: INIT_BODY, auth: { token: 'user-token' } } as never,
      mockRes() as never,
    );
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(transports['sess-async']).toBeDefined();
    capturedOnclose?.();
    expect(transports['sess-async']).toBeUndefined();
  });

  it('returns 400 for missing stream session', async () => {
    const { mcpStreamHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: vi.fn(),
        createClient: vi.fn(),
        createServer: vi.fn(),
      },
    );
    const res = mockRes();
    await mcpStreamHandler({ headers: {} } as never, res as never);
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when handler throws', async () => {
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: () => {
          throw new Error('boom');
        },
        createClient: vi.fn(),
        createServer: vi.fn(),
        log: vi.fn(),
      },
    );
    const res = mockRes();
    await mcpPostHandler(
      { headers: {}, body: INIT_BODY, auth: { token: 'user-token' } } as never,
      res as never,
    );
    expect(res.statusCode).toBe(500);
  });

  it('logs non-error failures', async () => {
    const log = vi.fn();
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: () => {
          throw 'boom';
        },
        createClient: vi.fn(),
        createServer: vi.fn(),
        log,
      },
    );
    const res = mockRes();
    await mcpPostHandler(
      { headers: {}, body: INIT_BODY, auth: { token: 'user-token' } } as never,
      res as never,
    );
    expect(log).toHaveBeenCalledWith('MCP HTTP error: boom');
  });

  it('skips 500 body when headers already sent', async () => {
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: () => {
          throw new Error('boom');
        },
        createClient: vi.fn(),
        createServer: vi.fn(),
        log: vi.fn(),
      },
    );
    const res = mockRes();
    res.headersSent = true;
    await mcpPostHandler(
      { headers: {}, body: INIT_BODY, auth: { token: 'user-token' } } as never,
      res as never,
    );
    expect(res.body).toBeUndefined();
  });

  it('ignores onclose when no session id is known', async () => {
    let onclose: (() => void) | undefined;
    const { mcpPostHandler } = createMcpHttpHandlers(
      { apiBase: 'http://127.0.0.1:3200' },
      {
        createTransport: ({ onclose: setOnclose }) => {
          onclose = setOnclose;
          return { handleRequest: vi.fn() } as never;
        },
        createClient: vi.fn(() => ({}) as never),
        createServer: vi.fn(() => ({ connect: vi.fn() }) as never),
      },
    );
    await mcpPostHandler(
      { headers: {}, body: INIT_BODY, auth: { token: 'user-token' } } as never,
      mockRes() as never,
    );
    expect(() => onclose?.()).not.toThrow();
  });
});

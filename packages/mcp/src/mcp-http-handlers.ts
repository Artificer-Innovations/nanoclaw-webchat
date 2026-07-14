import type express from 'express';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

import type { WebchatClient } from './client.js';
import { webchatLog } from './server.js';

export interface McpHttpHandlerDeps {
  createTransport: (handlers: {
    onsessioninitialized: (sid: string) => void;
    onclose: () => void;
  }) => StreamableHTTPServerTransport;
  createClient: (accessToken: string) => WebchatClient;
  createServer: (client: WebchatClient) => McpServer;
  log?: (msg: string) => void;
}

export interface McpHttpHandlerOptions {
  apiBase: string;
  requestTimeoutMs?: number;
}

export function createMcpHttpHandlers(
  options: McpHttpHandlerOptions,
  deps: McpHttpHandlerDeps,
) {
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const log = deps.log ?? webchatLog;

  const mcpPostHandler = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'];
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (sessionId && transports[sessionId as string]) {
        transport = transports[sessionId as string];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const accessToken = req.auth?.token;
        if (!accessToken) {
          res.status(401).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Unauthorized' },
            id: null,
          });
          return;
        }
        let activeSessionId: string | undefined;
        transport = deps.createTransport({
          onsessioninitialized: (sid) => {
            activeSessionId = sid;
            queueMicrotask(() => {
              transports[sid] = transport!;
            });
          },
          onclose: () => {
            const sid = activeSessionId ?? transport?.sessionId;
            if (sid && transports[sid]) delete transports[sid];
          },
        });
        const client = deps.createClient(accessToken);
        const server = deps.createServer(client);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      } else {
        res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
          id: null,
        });
        return;
      }
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      log(`MCP HTTP error: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  };

  const mcpStreamHandler = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !transports[sessionId as string]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await transports[sessionId as string]!.handleRequest(req, res);
  };

  return { mcpPostHandler, mcpStreamHandler, transports };
}

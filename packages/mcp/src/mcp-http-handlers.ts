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

interface BoundMcpSession {
  transport: StreamableHTTPServerTransport;
  userId: string;
}

function sessionUserId(req: express.Request): string | undefined {
  const extra = req.auth?.extra as { userId?: unknown } | undefined;
  return typeof extra?.userId === 'string' ? extra.userId : undefined;
}

export function createMcpHttpHandlers(
  options: McpHttpHandlerOptions,
  deps: McpHttpHandlerDeps,
) {
  // Map avoids prototype-key collisions from user-controlled session IDs.
  const transports = new Map<string, BoundMcpSession>();
  const log = deps.log ?? webchatLog;

  const rejectUnauthorizedSession = (res: express.Response): void => {
    res.status(403).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Forbidden: session does not belong to this user' },
      id: null,
    });
  };

  const mcpPostHandler = async (
    req: express.Request,
    res: express.Response,
  ): Promise<void> => {
    const sessionId = req.headers['mcp-session-id'];
    try {
      let transport: StreamableHTTPServerTransport | undefined;
      if (typeof sessionId === 'string' && transports.has(sessionId)) {
        const bound = transports.get(sessionId)!;
        const requestUserId = sessionUserId(req);
        if (!requestUserId || requestUserId !== bound.userId) {
          rejectUnauthorizedSession(res);
          return;
        }
        transport = bound.transport;
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const accessToken = req.auth?.token;
        const userId = sessionUserId(req);
        if (!accessToken || !userId) {
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
            // Register synchronously so an early onclose can still find the session.
            transports.set(sid, { transport: transport!, userId });
          },
          onclose: () => {
            const sid = activeSessionId ?? transport?.sessionId;
            if (sid) transports.delete(sid);
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
    if (typeof sessionId !== 'string' || !transports.has(sessionId)) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    const bound = transports.get(sessionId)!;
    const requestUserId = sessionUserId(req);
    if (!requestUserId || requestUserId !== bound.userId) {
      res.status(403).send('Forbidden: session does not belong to this user');
      return;
    }
    await bound.transport.handleRequest(req, res);
  };

  return { mcpPostHandler, mcpStreamHandler, transports };
}

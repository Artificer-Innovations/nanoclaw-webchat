import { randomUUID } from 'node:crypto';
import type { RequestListener } from 'node:http';

import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

import { WebchatClient } from './client.js';
import { createMcpHttpHandlers } from './mcp-http-handlers.js';
import { wrapWebchatMcpOAuthBackend, type WebchatMcpOAuthBackendLike } from './oauth-bridge.js';
import { createWebchatMcpServer } from './server.js';

export const MCP_HTTP_PATH = '/mcp';
export const MCP_OAUTH_SCOPES = ['mcp:tools'] as const;

export interface CreateMcpHttpDelegateOptions {
  apiBase: string;
  publicBaseUrl: string;
  oauthBackend: WebchatMcpOAuthBackendLike;
  requestTimeoutMs?: number;
}

export interface McpHttpDelegate {
  /** Express-compatible listener for co-hosted mounting. */
  listener: RequestListener;
  matchesPath: (pathname: string) => boolean;
}

export function mcpHttpPathMatches(pathname: string): boolean {
  return (
    pathname === MCP_HTTP_PATH ||
    pathname === '/authorize' ||
    pathname === '/token' ||
    pathname === '/register' ||
    pathname.startsWith('/.well-known/oauth-')
  );
}

export function createMcpHttpDelegate(options: CreateMcpHttpDelegateOptions): McpHttpDelegate {
  const issuerUrl = new URL(options.publicBaseUrl);
  const resourceServerUrl = new URL(MCP_HTTP_PATH, issuerUrl);
  const provider: OAuthServerProvider = wrapWebchatMcpOAuthBackend(options.oauthBackend);

  const app = createMcpExpressApp({ host: issuerUrl.hostname });
  // Align with REST MAX_BODY_BYTES (20 MiB) so MCP payloads are not unbounded.
  app.use(express.json({ limit: '20mb' }));
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl,
      resourceServerUrl,
      scopesSupported: [...MCP_OAUTH_SCOPES],
      resourceName: 'NanoClaw Web Chat',
    }),
  );

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceServerUrl);
  const authMiddleware = requireBearerAuth({
    verifier: provider,
    requiredScopes: [],
    resourceMetadataUrl,
  });

  const { mcpPostHandler, mcpStreamHandler } = createMcpHttpHandlers(
    { apiBase: options.apiBase, requestTimeoutMs: options.requestTimeoutMs },
    {
      createTransport: ({ onsessioninitialized, onclose }) => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized,
        });
        transport.onclose = onclose;
        return transport;
      },
      createClient: (accessToken) =>
        new WebchatClient({
          apiBase: options.apiBase,
          accessToken,
          timeoutMs: options.requestTimeoutMs,
        }),
      createServer: (client) =>
        // `client` supplies per-request accessToken auth; config.secret is unused in HTTP mode.
        createWebchatMcpServer({
          config: {
            apiBase: options.apiBase,
            secret: '',
            requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
          },
          client,
        }),
    },
  );

  app.post(MCP_HTTP_PATH, authMiddleware, mcpPostHandler);
  app.get(MCP_HTTP_PATH, authMiddleware, mcpStreamHandler);
  app.delete(MCP_HTTP_PATH, authMiddleware, mcpStreamHandler);

  return {
    listener: app as unknown as RequestListener,
    matchesPath: mcpHttpPathMatches,
  };
}

export { wrapWebchatMcpOAuthBackend };

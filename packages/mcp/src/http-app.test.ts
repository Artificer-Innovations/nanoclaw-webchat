import http from 'node:http';

import { describe, it, expect, afterEach } from 'vitest';

import { createMcpHttpDelegate, mcpHttpPathMatches } from './http-app.js';
import type { WebchatMcpOAuthBackendLike } from './oauth-bridge.js';

const PUBLIC_BASE = 'http://127.0.0.1:3200';

function mockBackend(): WebchatMcpOAuthBackendLike {
  return {
    clientsStore: {
      async getClient() {
        return undefined;
      },
      async registerClient(client) {
        return { ...client, client_id: client.client_id ?? 'generated' };
      },
    },
    buildAuthorizeReturnUrl: () => `${PUBLIC_BASE}/authorize`,
    authorize: () => ({ type: 'redirect', location: '/?returnTo=test' }),
    challengeForAuthorizationCode: async () => 'challenge',
    exchangeAuthorizationCode: async () => ({
      access_token: 'unused',
      token_type: 'bearer',
      expires_in: 3600,
      scope: 'mcp:tools',
    }),
    verifyAccessToken: (token) =>
      token === 'valid-token'
        ? {
            userId: 'web:basic:alice',
            displayName: 'Alice',
            clientId: 'client',
            scopes: ['mcp:tools'],
            resource: `${PUBLIC_BASE}/mcp`,
          }
        : null,
  };
}

async function withServer(
  listener: http.RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = http.createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    await run(port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

describe('createMcpHttpDelegate', () => {
  afterEach(() => {
    delete process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL;
  });

  it('exposes OAuth metadata and rejects unauthenticated MCP requests', async () => {
    process.env.MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL = 'true';
    const delegate = createMcpHttpDelegate({
      apiBase: PUBLIC_BASE,
      publicBaseUrl: PUBLIC_BASE,
      oauthBackend: mockBackend(),
    });

    await withServer(delegate.listener, async (port) => {
      const base = `http://127.0.0.1:${port}`;
      const metaRes = await fetch(`${base}/.well-known/oauth-authorization-server`);
      expect(metaRes.status).toBe(200);
      expect(await metaRes.json()).toMatchObject({
        issuer: `${PUBLIC_BASE}/`,
        authorization_endpoint: `${PUBLIC_BASE}/authorize`,
      });

      const mcpRes = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
      });
      expect(mcpRes.status).toBe(401);
    });
  });

  it('returns delegate path matcher', () => {
    const delegate = createMcpHttpDelegate({
      apiBase: PUBLIC_BASE,
      publicBaseUrl: PUBLIC_BASE,
      oauthBackend: mockBackend(),
    });
    expect(delegate.matchesPath('/mcp')).toBe(true);
    expect(delegate.matchesPath('/api/bootstrap')).toBe(false);
    expect(mcpHttpPathMatches('/authorize')).toBe(true);
    expect(mcpHttpPathMatches('/token')).toBe(true);
    expect(mcpHttpPathMatches('/register')).toBe(true);
    expect(mcpHttpPathMatches('/.well-known/oauth-protected-resource/mcp')).toBe(true);
  });
});

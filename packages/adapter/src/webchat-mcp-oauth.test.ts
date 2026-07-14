import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { authConfigForTests } from './webchat-auth-config.js';
import {
  createWebchatMcpOAuthBackend,
  MCP_DEFAULT_SCOPE,
  resetWebchatMcpOAuthForTests,
  verifyMcpAccessToken,
} from './webchat-mcp-oauth.js';
import {
  createSession,
  resetWebchatAuthSchemaForTests,
  signSessionCookie,
  WEBCHAT_SESSION_COOKIE,
} from './webchat-auth-sessions.js';

const PUBLIC_BASE = 'http://127.0.0.1:3200';
const RESOURCE_URL = `${PUBLIC_BASE}/mcp`;
const SESSION_SECRET = 'a'.repeat(32);

function publicAuthConfig() {
  return authConfigForTests({
    mode: 'public',
    public: {
      sessionSecret: SESSION_SECRET,
      sessionTtlSeconds: 3600,
      redirectUri: `${PUBLIC_BASE}/api/auth/callback`,
      oidcEnabled: false,
      providers: [],
      allowlist: { emailDomains: [], emails: [], subs: [], requiredGroup: null },
      basic: {
        enabled: true,
        password: 'pw',
        allowedUsernames: ['alice'],
        displayNames: new Map(),
      },
      secureCookies: false,
    },
  }).public!;
}

describe('webchat-mcp-oauth', () => {
  beforeEach(() => {
    resetWebchatAuthSchemaForTests();
    resetWebchatMcpOAuthForTests();
  });

  afterEach(() => {
    resetWebchatAuthSchemaForTests();
    resetWebchatMcpOAuthForTests();
  });

  it('issues and verifies user-scoped JWT access tokens', async () => {
    const backend = createWebchatMcpOAuthBackend({
      publicAuth: publicAuthConfig(),
      publicBaseUrl: PUBLIC_BASE,
      resourceServerUrl: RESOURCE_URL,
    });

    const client = await backend.clientsStore.registerClient({
      redirect_uris: ['http://127.0.0.1:8765/callback'],
      token_endpoint_auth_method: 'none',
    });

    const session = createSession(
      { userId: 'web:basic:alice', displayName: 'Alice', authMethod: 'basic' },
      3600,
    );
    const cookie = signSessionCookie(session.id, SESSION_SECRET);

    const authorizeReq = {
      originalUrl:
        '/authorize?client_id=' +
        client.client_id +
        '&redirect_uri=http%3A%2F%2F127.0.0.1%3A8765%2Fcallback&response_type=code&code_challenge=abc&code_challenge_method=S256',
      headers: { cookie: `${WEBCHAT_SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
    } as import('node:http').IncomingMessage;

    const redirect = backend.authorize(authorizeReq, client, {
      scopes: [MCP_DEFAULT_SCOPE],
      codeChallenge: 'abc',
      redirectUri: 'http://127.0.0.1:8765/callback',
      resource: RESOURCE_URL,
    });
    expect(redirect.location).toContain('code=');
    const code = new URL(redirect.location).searchParams.get('code');
    expect(code).toBeTruthy();

    const tokens = await backend.exchangeAuthorizationCode(client, code!, RESOURCE_URL);
    expect(tokens.access_token).toBeTruthy();

    const user = verifyMcpAccessToken(tokens.access_token, {
      publicAuth: publicAuthConfig(),
      resourceServerUrl: RESOURCE_URL,
    });
    expect(user).toEqual({
      userId: 'web:basic:alice',
      displayName: 'Alice',
      clientId: client.client_id,
      scopes: [MCP_DEFAULT_SCOPE],
      resource: RESOURCE_URL,
    });
  });

  it('redirects unauthenticated authorize requests to login', () => {
    const backend = createWebchatMcpOAuthBackend({
      publicAuth: publicAuthConfig(),
      publicBaseUrl: PUBLIC_BASE,
      resourceServerUrl: RESOURCE_URL,
    });

    const result = backend.authorize(
      { originalUrl: '/authorize?client_id=x', headers: {} } as import('node:http').IncomingMessage,
      {
        client_id: 'x',
        redirect_uris: ['http://127.0.0.1:8765/callback'],
      },
      {
        scopes: [MCP_DEFAULT_SCOPE],
        codeChallenge: 'abc',
        redirectUri: 'http://127.0.0.1:8765/callback',
      },
    );

    expect(result.location).toMatch(/^\/?\?returnTo=/);
  });

  it('rejects tokens with wrong audience', async () => {
    const backend = createWebchatMcpOAuthBackend({
      publicAuth: publicAuthConfig(),
      publicBaseUrl: PUBLIC_BASE,
      resourceServerUrl: RESOURCE_URL,
    });
    const client = await backend.clientsStore.registerClient({
      redirect_uris: ['http://127.0.0.1:8765/callback'],
      token_endpoint_auth_method: 'none',
    });
    const session = createSession(
      { userId: 'web:basic:alice', displayName: 'Alice', authMethod: 'basic' },
      3600,
    );
    const cookie = signSessionCookie(session.id, SESSION_SECRET);
    const redirect = backend.authorize(
      {
        originalUrl: '/authorize',
        headers: { cookie: `${WEBCHAT_SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
      } as import('node:http').IncomingMessage,
      client,
      {
        scopes: [MCP_DEFAULT_SCOPE],
        codeChallenge: crypto.createHash('sha256').update('verifier').digest('base64url'),
        redirectUri: 'http://127.0.0.1:8765/callback',
        resource: RESOURCE_URL,
      },
    );
    const code = new URL(redirect.location).searchParams.get('code')!;
    const tokens = await backend.exchangeAuthorizationCode(client, code, RESOURCE_URL);
    expect(
      verifyMcpAccessToken(tokens.access_token, {
        publicAuth: publicAuthConfig(),
        resourceServerUrl: 'http://127.0.0.1:3200/other',
      }),
    ).toBeNull();
  });
});

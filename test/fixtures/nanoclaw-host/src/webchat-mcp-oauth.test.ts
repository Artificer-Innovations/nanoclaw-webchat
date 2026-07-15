import crypto from 'crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { authConfigForTests } from './webchat-auth-config.js';
import {
  createWebchatMcpOAuthBackend,
  MCP_DEFAULT_SCOPE,
  MCP_OAUTH_CLIENT_TTL_SECONDS,
  purgeStaleMcpOAuthClients,
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
const REDIRECT = 'http://127.0.0.1:8765/callback';

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

function backend() {
  return createWebchatMcpOAuthBackend({
    publicAuth: publicAuthConfig(),
    publicBaseUrl: PUBLIC_BASE,
    resourceServerUrl: RESOURCE_URL,
  });
}

async function mintCode(opts?: { challenge?: string; redirectUri?: string }) {
  const b = backend();
  const client = await b.clientsStore.registerClient({
    redirect_uris: [REDIRECT],
    token_endpoint_auth_method: 'none',
  });
  const session = createSession(
    { userId: 'web:basic:alice', displayName: 'Alice', authMethod: 'basic' },
    3600,
  );
  const cookie = signSessionCookie(session.id, SESSION_SECRET);
  const codeChallenge =
    opts?.challenge ?? crypto.createHash('sha256').update('verifier').digest('base64url');
  const redirect = b.authorize(
    {
      originalUrl: '/authorize',
      headers: { cookie: `${WEBCHAT_SESSION_COOKIE}=${encodeURIComponent(cookie)}` },
    } as import('node:http').IncomingMessage,
    client,
    {
      scopes: [MCP_DEFAULT_SCOPE],
      codeChallenge,
      redirectUri: opts?.redirectUri ?? REDIRECT,
      resource: RESOURCE_URL,
    },
  );
  const code = new URL(redirect.location).searchParams.get('code')!;
  return { backend: b, client, code, codeChallenge };
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
    const { backend: b, client, code } = await mintCode();
    const tokens = await b.exchangeAuthorizationCode(client, code, RESOURCE_URL, {
      codeVerifier: 'verifier',
      redirectUri: REDIRECT,
    });
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.expires_in).toBe(86_400);

    const user = verifyMcpAccessToken(tokens.access_token, {
      publicAuth: publicAuthConfig(),
      resourceServerUrl: RESOURCE_URL,
      publicBaseUrl: PUBLIC_BASE,
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
    const b = backend();
    const result = b.authorize(
      { originalUrl: '/authorize?client_id=x', headers: {} } as import('node:http').IncomingMessage,
      {
        client_id: 'x',
        redirect_uris: [REDIRECT],
      },
      {
        scopes: [MCP_DEFAULT_SCOPE],
        codeChallenge: 'abc',
        redirectUri: REDIRECT,
      },
    );

    expect(result.location).toMatch(/^\/?\?returnTo=/);
  });

  it('rejects tokens with wrong audience', async () => {
    const { backend: b, client, code } = await mintCode();
    const tokens = await b.exchangeAuthorizationCode(client, code, RESOURCE_URL, {
      codeVerifier: 'verifier',
      redirectUri: REDIRECT,
    });
    expect(
      verifyMcpAccessToken(tokens.access_token, {
        publicAuth: publicAuthConfig(),
        resourceServerUrl: 'http://127.0.0.1:3200/other',
        publicBaseUrl: PUBLIC_BASE,
      }),
    ).toBeNull();
  });

  it('rejects redirect_uri mismatch on token exchange', async () => {
    const { backend: b, client, code } = await mintCode();
    await expect(
      b.exchangeAuthorizationCode(client, code, RESOURCE_URL, {
        codeVerifier: 'verifier',
        redirectUri: 'http://127.0.0.1:9999/evil',
      }),
    ).rejects.toThrow(/redirect_uri mismatch/);
  });

  it('rejects invalid PKCE code_verifier on token exchange', async () => {
    const { backend: b, client, code } = await mintCode();
    await expect(
      b.exchangeAuthorizationCode(client, code, RESOURCE_URL, {
        codeVerifier: 'wrong-verifier',
        redirectUri: REDIRECT,
      }),
    ).rejects.toThrow(/Invalid PKCE/);
  });

  it('purges stale oauth clients', async () => {
    const b = backend();
    await b.clientsStore.registerClient({
      client_id: 'old-client',
      client_id_issued_at: Math.floor(Date.now() / 1000) - MCP_OAUTH_CLIENT_TTL_SECONDS - 10,
      redirect_uris: [REDIRECT],
    });
    expect(purgeStaleMcpOAuthClients()).toBeGreaterThanOrEqual(1);
    expect(await b.clientsStore.getClient('old-client')).toBeUndefined();
  });
});

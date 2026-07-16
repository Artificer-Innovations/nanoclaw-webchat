import crypto from 'crypto';
import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-web-auth-test' };
});

import { authConfigForTests } from './webchat-auth-config.js';
import {
  checkOidcAllowlist,
  handlePublicAuthRequest,
  resetWebchatAuthCachesForTests,
  validateBasicLogin,
  verifyOidcIdTokenForTests,
} from './webchat-auth.js';
import {
  createSession,
  getSession,
  parseSessionCookie,
  resetWebchatAuthSchemaForTests,
  saveOAuthState,
  signSessionCookie,
} from './webchat-auth-sessions.js';
import type { IncomingMessage, ServerResponse } from 'http';

const TEST_DATA = '/tmp/nanoclaw-web-auth-test';

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKey: crypto.KeyObject,
  kid = 'test-key',
): string {
  const header = { alg: 'RS256', typ: 'JWT', kid };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function rsaJwkFromPublicKey(publicKey: crypto.KeyObject, kid: string) {
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}

describe('webchat-auth', () => {
  beforeEach(() => {
    resetWebchatAuthCachesForTests();
    resetWebchatAuthSchemaForTests();
    if (fs.existsSync(TEST_DATA)) fs.rmSync(TEST_DATA, { recursive: true, force: true });
    fs.mkdirSync(TEST_DATA, { recursive: true });
  });

  it('validates basic login against allowlist and password', () => {
    const cfg = authConfigForTests({
      mode: 'public',
      public: {
        sessionSecret: 'secret',
        sessionTtlSeconds: 3600,
        redirectUri: 'http://localhost/cb',
        oidcEnabled: false,
        providers: [],
        allowlist: { emailDomains: [], emails: [], subs: [], requiredGroup: null },
        basic: {
          enabled: true,
          password: 'hunter2',
          allowedUsernames: ['alice'],
          displayNames: new Map([['alice', 'Alice']]),
        },
        secureCookies: false,
      },
    }).public!;

    expect(validateBasicLogin(cfg, 'alice', 'hunter2')?.displayName).toBe('Alice');
    expect(validateBasicLogin(cfg, 'bob', 'hunter2')).toBeNull();
    expect(validateBasicLogin(cfg, 'alice', 'wrong')).toBeNull();
    expect(validateBasicLogin(cfg, 'alic', 'hunter2')).toBeNull();
  });

  it('matches allowed usernames with constant-time comparison across the list', () => {
    const cfg = authConfigForTests({
      mode: 'public',
      public: {
        sessionSecret: 'secret',
        sessionTtlSeconds: 3600,
        redirectUri: 'http://localhost/cb',
        oidcEnabled: false,
        providers: [],
        allowlist: { emailDomains: [], emails: [], subs: [], requiredGroup: null },
        basic: {
          enabled: true,
          password: 'hunter2',
          allowedUsernames: ['bob', 'alice'],
          displayNames: new Map([
            ['alice', 'Alice'],
            ['bob', 'Bob'],
          ]),
        },
        secureCookies: false,
      },
    }).public!;

    expect(validateBasicLogin(cfg, 'alice', 'hunter2')?.displayName).toBe('Alice');
    expect(validateBasicLogin(cfg, 'bob', 'hunter2')?.displayName).toBe('Bob');
  });

  it('refetches JWKS after signature failure (key rotation)', async () => {
    const issuer = 'https://issuer.example';
    const jwksUri = `${issuer}/jwks`;
    const staleKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const currentKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const staleJwk = rsaJwkFromPublicKey(staleKeys.publicKey, 'stale');
    const currentJwk = rsaJwkFromPublicKey(currentKeys.publicKey, 'current');

    const now = Math.floor(Date.now() / 1000);
    const idToken = signRs256Jwt(
      { iss: issuer, aud: 'client-id', sub: 'user-1', exp: now + 3600 },
      currentKeys.privateKey,
      'current',
    );

    let jwksFetchCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === `${issuer}/.well-known/openid-configuration`) {
        return new Response(
          JSON.stringify({
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: jwksUri,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === jwksUri) {
        jwksFetchCount += 1;
        const keys = jwksFetchCount === 1 ? [staleJwk] : [currentJwk];
        return new Response(JSON.stringify({ keys }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    try {
      const claims = await verifyOidcIdTokenForTests(idToken, {
        id: 'test',
        label: 'Test',
        protocol: 'oidc',
        issuer,
        clientId: 'client-id',
        clientSecret: 'secret',
        scopes: 'openid profile email',
      });

      expect(claims.sub).toBe('user-1');
      expect(jwksFetchCount).toBe(2);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('creates and validates signed session cookies', () => {
    const record = createSession(
      { userId: 'web:basic:alice', displayName: 'Alice', authMethod: 'basic' },
      3600,
    );
    const signed = signSessionCookie(record.id, 'session-secret');
    const parsed = parseSessionCookie(signed, 'session-secret');
    expect(parsed).toBe(record.id);
    expect(getSession(record.id)?.userId).toBe('web:basic:alice');
  });

  it('checks oidc allowlist by email domain', () => {
    const allowlist = {
      emailDomains: ['company.com'],
      emails: [],
      subs: [],
      requiredGroup: null,
    };
    expect(
      checkOidcAllowlist(allowlist, 'google', {
        sub: '1',
        email: 'alice@company.com',
        email_verified: true,
      }),
    ).toBe(true);
    expect(
      checkOidcAllowlist(allowlist, 'google', {
        sub: '2',
        email: 'bob@other.com',
        email_verified: true,
      }),
    ).toBe(false);
  });

  it('OIDC callback redirects to WEBCHAT_PUBLIC_PATH home after login', async () => {
    const cfg = authConfigForTests({
      mode: 'public',
      public: {
        sessionSecret: 'secret',
        sessionTtlSeconds: 3600,
        redirectUri: 'http://localhost/api/auth/callback',
        oidcEnabled: true,
        providers: [
          {
            id: 'github',
            label: 'GitHub',
            protocol: 'oauth',
            authorizationUrl: 'https://github.com/login/oauth/authorize',
            tokenUrl: 'https://github.com/login/oauth/access_token',
            clientId: 'client-id',
            clientSecret: 'client-secret',
            scopes: 'read:user user:email',
          },
        ],
        allowlist: {
          emailDomains: [],
          emails: ['alice@example.com'],
          subs: [],
          requiredGroup: null,
        },
        basic: {
          enabled: false,
          password: '',
          allowedUsernames: [],
          displayNames: new Map(),
        },
        secureCookies: false,
      },
    }).public!;

    saveOAuthState('test-state', 'github', 'verifier');

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://github.com/login/oauth/access_token') {
        return new Response(JSON.stringify({ access_token: 'gh-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === 'https://api.github.com/user') {
        return new Response(
          JSON.stringify({ id: 42, login: 'alice', email: 'alice@example.com', name: 'Alice' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    });

    const headers: Record<string, string | number | string[]> = {};
    let statusCode = 0;
    const res = {
      writeHead(status: number, h?: Record<string, string | number | string[]>) {
        statusCode = status;
        if (h) Object.assign(headers, h);
        return res;
      },
      setHeader(name: string, value: string | number | readonly string[]) {
        headers[name] = value as string;
      },
      end() {},
    } as unknown as ServerResponse;

    const req = { method: 'GET', headers: {} } as IncomingMessage;
    const url = new URL('http://localhost/api/auth/callback?code=abc&state=test-state');

    try {
      const handled = await handlePublicAuthRequest(
        req,
        res,
        url,
        cfg,
        () => {},
        () => {},
        '/webchat',
      );
      expect(handled).toBe(true);
      expect(statusCode).toBe(302);
      expect(headers.Location).toBe('/webchat/');

      saveOAuthState('test-state-root', 'github', 'verifier');
      statusCode = 0;
      delete headers.Location;
      const handledRoot = await handlePublicAuthRequest(
        req,
        res,
        new URL('http://localhost/api/auth/callback?code=abc&state=test-state-root'),
        cfg,
        () => {},
        () => {},
      );
      expect(handledRoot).toBe(true);
      expect(statusCode).toBe(302);
      expect(headers.Location).toBe('/');

      let htmlBody = '';
      const htmlRes = {
        writeHead(status: number) {
          statusCode = status;
          return htmlRes;
        },
        setHeader() {},
        end(chunk?: string) {
          htmlBody = chunk ?? '';
        },
      } as unknown as ServerResponse;
      statusCode = 0;
      const cancelled = await handlePublicAuthRequest(
        req,
        htmlRes,
        new URL('http://localhost/api/auth/callback?error=access_denied'),
        cfg,
        () => {},
        () => {},
        '/webchat',
      );
      expect(cancelled).toBe(true);
      expect(statusCode).toBe(403);
      expect(htmlBody).toContain('href="/webchat/"');
    } finally {
      fetchMock.mockRestore();
    }
  });
});

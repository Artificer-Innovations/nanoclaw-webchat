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
  resetWebchatAuthCachesForTests,
  validateBasicLogin,
  verifyOidcIdTokenForTests,
} from './webchat-auth.js';
import {
  createSession,
  getSession,
  parseSessionCookie,
  resetWebchatAuthSchemaForTests,
  signSessionCookie,
} from './webchat-auth-sessions.js';

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
});

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
        externalSession: {
          enabled: false,
          cookieName: '',
          jwksUrl: '',
          issuer: '',
          audience: '',
          userIdClaim: 'sub',
          displayNameClaim: 'name',
          userIdPrefix: 'web:ext:',
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
        externalSession: {
          enabled: false,
          cookieName: '',
          jwksUrl: '',
          issuer: '',
          audience: '',
          userIdClaim: 'sub',
          displayNameClaim: 'name',
          userIdPrefix: 'web:ext:',
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
        externalSession: {
          enabled: false,
          cookieName: '',
          jwksUrl: '',
          issuer: '',
          audience: '',
          userIdClaim: 'sub',
          displayNameClaim: 'name',
          userIdPrefix: 'web:ext:',
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

  describe('external JWT session', () => {
    const issuer = 'https://parent.example';
    const audience = 'webchat-aud';
    const jwksUri = `${issuer}/.well-known/jwks.json`;
    const cookieName = 'parent_session';

    function externalPublicConfig(
      allowlist: {
        emailDomains: string[];
        emails: string[];
        subs: string[];
        requiredGroup: string | null;
      } = { emailDomains: [], emails: [], subs: [], requiredGroup: null },
      externalOverrides: Partial<{
        userIdClaim: string;
        displayNameClaim: string;
        userIdPrefix: string;
      }> = {},
    ) {
      return authConfigForTests({
        mode: 'public',
        public: {
          sessionSecret: 's'.repeat(32),
          sessionTtlSeconds: 3600,
          redirectUri: '',
          oidcEnabled: false,
          providers: [],
          allowlist,
          basic: {
            enabled: false,
            password: '',
            allowedUsernames: [],
            displayNames: new Map(),
          },
          externalSession: {
            enabled: true,
            cookieName,
            jwksUrl: jwksUri,
            issuer,
            audience,
            userIdClaim: 'sub',
            displayNameClaim: 'name',
            userIdPrefix: 'web:ext:',
            ...externalOverrides,
          },
          secureCookies: false,
        },
      }).public!;
    }

    it('establishes webchat_session from a valid external JWT cookie', async () => {
      const { verifyExternalSessionUser, tryEstablishExternalSession, resolveSessionUser, buildAuthConfigResponse } =
        await import('./webchat-auth.js');

      const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = rsaJwkFromPublicKey(keys.publicKey, 'k1');
      const jwt = signRs256Jwt(
        {
          sub: 'user-123',
          name: 'Pat Parent',
          email: 'pat@example.com',
          iss: issuer,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        keys.privateKey,
        'k1',
      );

      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      try {
        const cfg = externalPublicConfig();
        expect(buildAuthConfigResponse(cfg).externalSession).toEqual({ enabled: true });

        const req = {
          headers: { cookie: `${cookieName}=${jwt}` },
        } as IncomingMessage;

        const verified = await verifyExternalSessionUser(cfg, req);
        expect(verified).toMatchObject({
          userId: 'web:ext:user-123',
          displayName: 'Pat Parent',
          authMethod: 'external',
        });

        const setCookie: string[] = [];
        const res = {
          setHeader(name: string, value: string) {
            if (name.toLowerCase() === 'set-cookie') setCookie.push(value);
          },
        } as unknown as ServerResponse;
        const logins: string[] = [];
        const established = await tryEstablishExternalSession(
          cfg,
          req,
          (u) => logins.push(u.userId),
          res,
        );
        expect(established).toEqual({ userId: 'web:ext:user-123', displayName: 'Pat Parent' });
        expect(logins).toEqual(['web:ext:user-123']);
        expect(setCookie.some((c) => c.startsWith('webchat_session='))).toBe(true);

        const cookieHeader = setCookie[0]!;
        const match = /webchat_session=([^;]+)/.exec(cookieHeader);
        expect(match).toBeTruthy();
        const sessionId = parseSessionCookie(decodeURIComponent(match![1]!), cfg.sessionSecret);
        expect(sessionId).toBeTruthy();
        expect(getSession(sessionId!)?.authMethod).toBe('external');

        const withSession = {
          headers: { cookie: `webchat_session=${match![1]!}` },
        } as IncomingMessage;
        expect(resolveSessionUser(cfg, withSession)).toEqual({
          userId: 'web:ext:user-123',
          displayName: 'Pat Parent',
        });
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('rejects external JWT with wrong audience', async () => {
      const { verifyExternalSessionUser } = await import('./webchat-auth.js');
      const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = rsaJwkFromPublicKey(keys.publicKey, 'k1');
      const jwt = signRs256Jwt(
        {
          sub: 'user-123',
          name: 'Pat',
          iss: issuer,
          aud: 'wrong-aud',
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        keys.privateKey,
      );
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
      );
      try {
        const cfg = externalPublicConfig();
        const req = { headers: { cookie: `${cookieName}=${jwt}` } } as IncomingMessage;
        expect(await verifyExternalSessionUser(cfg, req)).toBeNull();
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('rejects external JWT when allowlist does not match', async () => {
      const { verifyExternalSessionUser } = await import('./webchat-auth.js');
      const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = rsaJwkFromPublicKey(keys.publicKey, 'k1');
      const jwt = signRs256Jwt(
        {
          sub: 'user-123',
          email: 'pat@example.com',
          iss: issuer,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        keys.privateKey,
      );
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
      );
      try {
        const cfg = externalPublicConfig({
          emailDomains: [],
          emails: ['other@example.com'],
          subs: [],
          requiredGroup: null,
        });
        const req = { headers: { cookie: `${cookieName}=${jwt}` } } as IncomingMessage;
        expect(await verifyExternalSessionUser(cfg, req)).toBeNull();
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('respects explicit email_verified=false for email-domain allowlists', async () => {
      const { verifyExternalSessionUser } = await import('./webchat-auth.js');
      const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = rsaJwkFromPublicKey(keys.publicKey, 'k1');
      const unverified = signRs256Jwt(
        {
          sub: 'user-123',
          email: 'pat@example.com',
          email_verified: false,
          iss: issuer,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        keys.privateKey,
      );
      const omitted = signRs256Jwt(
        {
          sub: 'user-456',
          email: 'pat@example.com',
          iss: issuer,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        keys.privateKey,
      );
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
      );
      try {
        const cfg = externalPublicConfig({
          emailDomains: ['example.com'],
          emails: [],
          subs: [],
          requiredGroup: null,
        });
        await expect(
          verifyExternalSessionUser(cfg, {
            headers: { cookie: `${cookieName}=${unverified}` },
          } as IncomingMessage),
        ).resolves.toBeNull();
        await expect(
          verifyExternalSessionUser(cfg, {
            headers: { cookie: `${cookieName}=${omitted}` },
          } as IncomingMessage),
        ).resolves.toMatchObject({ userId: 'web:ext:user-456' });
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('treats a malformed external cookie as an auth miss (no throw)', async () => {
      const { verifyExternalSessionUser } = await import('./webchat-auth.js');
      const cfg = externalPublicConfig();
      const req = { headers: { cookie: `${cookieName}=%E0%A4%A` } } as IncomingMessage;
      await expect(verifyExternalSessionUser(cfg, req)).resolves.toBeNull();
    });

    it('allowlists ext:<id> using WEBCHAT_EXTERNAL_USER_ID_CLAIM, not raw JWT sub', async () => {
      const { verifyExternalSessionUser } = await import('./webchat-auth.js');
      const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const jwk = rsaJwkFromPublicKey(keys.publicKey, 'k1');
      const jwt = signRs256Jwt(
        {
          sub: 'jwt-sub-ignored-for-allowlist',
          uid: 'stable-uid',
          name: 'Pat Parent',
          iss: issuer,
          aud: audience,
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        keys.privateKey,
      );
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
      );
      try {
        const allowByUid = externalPublicConfig(
          {
            emailDomains: [],
            emails: [],
            subs: ['ext:stable-uid'],
            requiredGroup: null,
          },
          { userIdClaim: 'uid' },
        );
        const allowByJwtSub = externalPublicConfig(
          {
            emailDomains: [],
            emails: [],
            subs: ['ext:jwt-sub-ignored-for-allowlist'],
            requiredGroup: null,
          },
          { userIdClaim: 'uid' },
        );
        const req = { headers: { cookie: `${cookieName}=${jwt}` } } as IncomingMessage;
        await expect(verifyExternalSessionUser(allowByUid, req)).resolves.toMatchObject({
          userId: 'web:ext:stable-uid',
        });
        await expect(verifyExternalSessionUser(allowByJwtSub, req)).resolves.toBeNull();
      } finally {
        fetchMock.mockRestore();
      }
    });

    it('does not override an existing webchat_session', async () => {
      const { tryEstablishExternalSession, resolveSessionUser } = await import('./webchat-auth.js');
      const cfg = externalPublicConfig();
      const existing = createSession(
        { userId: 'web:basic:alice', displayName: 'Alice', authMethod: 'basic' },
        3600,
      );
      const cookie = signSessionCookie(existing.id, cfg.sessionSecret);
      const req = {
        headers: { cookie: `webchat_session=${encodeURIComponent(cookie)}; ${cookieName}=ignored` },
      } as IncomingMessage;
      const logins: string[] = [];
      const result = await tryEstablishExternalSession(cfg, req, (u) => logins.push(u.userId));
      expect(result).toEqual({ userId: 'web:basic:alice', displayName: 'Alice' });
      expect(logins).toEqual([]);
      expect(resolveSessionUser(cfg, req)?.userId).toBe('web:basic:alice');
    });
  });
});

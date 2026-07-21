import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { loadWebAdapterAuthConfig, MIN_SESSION_SECRET_LENGTH } from './webchat-auth-config.js';
import { log } from './log.js';

const ENV_KEYS = [
  'WEBCHAT_ENABLED',
  'WEBCHAT_SECRET',
  'WEBCHAT_AUTH_MODE',
  'WEBCHAT_AUTH_BASIC_ENABLED',
  'WEBCHAT_AUTH_OIDC_ENABLED',
  'WEBCHAT_BASIC_PASSWORD',
  'WEBCHAT_BASIC_ALLOWED_USERNAMES',
  'WEBCHAT_SESSION_SECRET',
  'WEBCHAT_SECURE_COOKIES',
  'WEBCHAT_SESSION_INSECURE_COOKIES',
  'WEBCHAT_PUBLIC_BASE_URL',
  'WEBCHAT_OIDC_REDIRECT_URI',
  'WEBCHAT_OIDC_PROVIDERS',
  'WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS',
  'WEBCHAT_OIDC_ALLOWED_EMAILS',
  'WEBCHAT_OIDC_ALLOWED_SUBS',
  'WEBCHAT_OIDC_REQUIRED_GROUP',
  'WEBCHAT_EXTERNAL_SESSION_ENABLED',
  'WEBCHAT_EXTERNAL_SESSION_COOKIE',
  'WEBCHAT_EXTERNAL_JWKS_URL',
  'WEBCHAT_EXTERNAL_JWT_ISS',
  'WEBCHAT_EXTERNAL_JWT_AUD',
  'WEBCHAT_EXTERNAL_USER_ID_CLAIM',
  'WEBCHAT_EXTERNAL_DISPLAY_NAME_CLAIM',
  'WEBCHAT_EXTERNAL_USER_ID_PREFIX',
  'NODE_ENV',
] as const;

const saved: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined): void {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function publicEnv(): void {
  setEnv('WEBCHAT_ENABLED', 'true');
  setEnv('WEBCHAT_SECRET', 'web-secret');
  setEnv('WEBCHAT_AUTH_MODE', 'public');
  setEnv('WEBCHAT_AUTH_BASIC_ENABLED', 'true');
  setEnv('WEBCHAT_BASIC_PASSWORD', 'test-password');
  setEnv('WEBCHAT_BASIC_ALLOWED_USERNAMES', 'alice');
  setEnv('WEBCHAT_SESSION_SECRET', 'a'.repeat(MIN_SESSION_SECRET_LENGTH));
  setEnv('WEBCHAT_PUBLIC_BASE_URL', 'http://127.0.0.1:3200');
}

describe('loadWebAdapterAuthConfig', () => {
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const prev = saved[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
      delete saved[key];
    }
  });

  it('defaults secureCookies to true in public mode', () => {
    publicEnv();
    delete process.env.WEBCHAT_SECURE_COOKIES;
    delete process.env.WEBCHAT_SESSION_INSECURE_COOKIES;
    delete process.env.NODE_ENV;

    const cfg = loadWebAdapterAuthConfig();
    expect(cfg?.public?.secureCookies).toBe(true);
  });

  it('allows WEBCHAT_SESSION_INSECURE_COOKIES for local dev', () => {
    publicEnv();
    setEnv('WEBCHAT_SESSION_INSECURE_COOKIES', 'true');

    const cfg = loadWebAdapterAuthConfig();
    expect(cfg?.public?.secureCookies).toBe(false);
  });

  it('rejects short WEBCHAT_SESSION_SECRET', () => {
    publicEnv();
    setEnv('WEBCHAT_SESSION_SECRET', 'too-short');

    expect(() => loadWebAdapterAuthConfig()).toThrow(/at least/);
  });

  it('defaults mcpHttpEnabled to true in public mode', () => {
    publicEnv();
    const cfg = loadWebAdapterAuthConfig();
    expect(cfg?.mcpHttpEnabled).toBe(true);
    expect(cfg?.publicBaseUrl).toBe('http://127.0.0.1:3200');
  });

  it('warns when public OIDC is enabled with an empty allowlist', () => {
    publicEnv();
    setEnv('WEBCHAT_AUTH_BASIC_ENABLED', undefined);
    setEnv('WEBCHAT_AUTH_OIDC_ENABLED', 'true');
    setEnv('WEBCHAT_OIDC_REDIRECT_URI', 'http://127.0.0.1:3200/api/auth/callback');
    setEnv(
      'WEBCHAT_OIDC_PROVIDERS',
      JSON.stringify([
        {
          id: 'github',
          label: 'GitHub',
          protocol: 'oauth',
          authorizationUrl: 'https://github.com/login/oauth/authorize',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          userInfoUrl: 'https://api.github.com/user',
          clientId: 'id',
          clientSecret: 'secret',
          scopes: 'read:user user:email',
        },
      ]),
    );
    delete process.env.WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS;
    delete process.env.WEBCHAT_OIDC_ALLOWED_EMAILS;
    delete process.env.WEBCHAT_OIDC_ALLOWED_SUBS;
    delete process.env.WEBCHAT_OIDC_REQUIRED_GROUP;

    vi.mocked(log.warn).mockClear();
    const cfg = loadWebAdapterAuthConfig();
    expect(cfg?.public?.oidcEnabled).toBe(true);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      expect.stringContaining('allowlist is empty'),
    );
  });

  it('allows public mode with only external session enabled', () => {
    publicEnv();
    setEnv('WEBCHAT_AUTH_BASIC_ENABLED', undefined);
    setEnv('WEBCHAT_AUTH_OIDC_ENABLED', undefined);
    setEnv('WEBCHAT_EXTERNAL_SESSION_ENABLED', 'true');
    setEnv('WEBCHAT_EXTERNAL_SESSION_COOKIE', 'parent_session');
    setEnv('WEBCHAT_EXTERNAL_JWKS_URL', 'https://auth.example/.well-known/jwks.json');
    setEnv('WEBCHAT_EXTERNAL_JWT_ISS', 'https://auth.example');
    setEnv('WEBCHAT_EXTERNAL_JWT_AUD', 'webchat');

    const cfg = loadWebAdapterAuthConfig();
    expect(cfg?.public?.externalSession.enabled).toBe(true);
    expect(cfg?.public?.externalSession.cookieName).toBe('parent_session');
    expect(cfg?.public?.externalSession.userIdPrefix).toBe('web:ext:');
    expect(cfg?.public?.oidcEnabled).toBe(false);
    expect(cfg?.public?.basic.enabled).toBe(false);
  });

  it('trims and defaults an empty external user id prefix', () => {
    publicEnv();
    setEnv('WEBCHAT_AUTH_BASIC_ENABLED', undefined);
    setEnv('WEBCHAT_EXTERNAL_SESSION_ENABLED', 'true');
    setEnv('WEBCHAT_EXTERNAL_SESSION_COOKIE', 'parent_session');
    setEnv('WEBCHAT_EXTERNAL_JWKS_URL', 'https://auth.example/.well-known/jwks.json');
    setEnv('WEBCHAT_EXTERNAL_JWT_ISS', 'https://auth.example');
    setEnv('WEBCHAT_EXTERNAL_JWT_AUD', 'webchat');
    setEnv('WEBCHAT_EXTERNAL_USER_ID_PREFIX', '  ');

    const cfg = loadWebAdapterAuthConfig();
    expect(cfg?.public?.externalSession.userIdPrefix).toBe('web:ext:');
  });

  it('rejects external session without JWKS URL', () => {
    publicEnv();
    setEnv('WEBCHAT_AUTH_BASIC_ENABLED', undefined);
    setEnv('WEBCHAT_EXTERNAL_SESSION_ENABLED', 'true');
    setEnv('WEBCHAT_EXTERNAL_SESSION_COOKIE', 'parent_session');
    setEnv('WEBCHAT_EXTERNAL_JWT_ISS', 'https://auth.example');
    setEnv('WEBCHAT_EXTERNAL_JWT_AUD', 'webchat');

    expect(() => loadWebAdapterAuthConfig()).toThrow(/WEBCHAT_EXTERNAL_JWKS_URL/);
  });
});

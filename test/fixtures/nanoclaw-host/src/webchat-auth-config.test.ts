import { afterEach, describe, expect, it } from 'vitest';

import { loadWebAdapterAuthConfig, MIN_SESSION_SECRET_LENGTH } from './webchat-auth-config.js';

const ENV_KEYS = [
  'WEBCHAT_ENABLED',
  'WEBCHAT_SECRET',
  'WEBCHAT_AUTH_MODE',
  'WEBCHAT_AUTH_BASIC_ENABLED',
  'WEBCHAT_BASIC_PASSWORD',
  'WEBCHAT_BASIC_ALLOWED_USERNAMES',
  'WEBCHAT_SESSION_SECRET',
  'WEBCHAT_SECURE_COOKIES',
  'WEBCHAT_SESSION_INSECURE_COOKIES',
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
});

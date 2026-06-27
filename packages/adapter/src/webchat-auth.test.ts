import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config.js', async () => {
  const actual = await vi.importActual<typeof import('../config.js')>('../config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-web-auth-test' };
});

import { authConfigForTests } from './webchat-auth-config.js';
import { checkOidcAllowlist, validateBasicLogin } from './webchat-auth.js';
import {
  createSession,
  getSession,
  parseSessionCookie,
  resetWebchatAuthSchemaForTests,
  signSessionCookie,
} from './webchat-auth-sessions.js';

const TEST_DATA = '/tmp/nanoclaw-web-auth-test';

describe('webchat-auth', () => {
  beforeEach(() => {
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

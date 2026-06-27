/**
 * Public auth configuration from environment and OIDC providers JSON.
 */
import fs from 'fs';

import { readEnvFile } from './env.js';

export type WebchatAuthMode = 'local' | 'public';

export type OidcProviderProtocol = 'oidc' | 'oauth';

export interface OidcProviderConfig {
  id: string;
  label: string;
  protocol: OidcProviderProtocol;
  issuer?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export interface BasicAuthConfig {
  enabled: boolean;
  password: string;
  allowedUsernames: string[];
  displayNames: Map<string, string>;
}

export interface OidcAllowlistConfig {
  emailDomains: string[];
  emails: string[];
  subs: string[];
  requiredGroup: string | null;
}

export interface PublicAuthConfig {
  sessionSecret: string;
  sessionTtlSeconds: number;
  redirectUri: string;
  oidcEnabled: boolean;
  providers: OidcProviderConfig[];
  allowlist: OidcAllowlistConfig;
  basic: BasicAuthConfig;
  secureCookies: boolean;
}

export interface WebAdapterAuthConfig {
  mode: WebchatAuthMode;
  bindAddress: string;
  authToken: string;
  localUserId: string;
  localDisplayName: string;
  public?: PublicAuthConfig;
}

const ENV_KEYS = [
  'WEBCHAT_ENABLED',
  'WEBCHAT_PORT',
  'WEBCHAT_SECRET',
  'WEBCHAT_USER_ID',
  'WEBCHAT_DISPLAY_NAME',
  'WEBCHAT_AUTH_MODE',
  'WEBCHAT_BIND_ADDRESS',
  'WEBCHAT_AUTH_OIDC_ENABLED',
  'WEBCHAT_AUTH_BASIC_ENABLED',
  'WEBCHAT_OIDC_PROVIDERS',
  'WEBCHAT_OIDC_PROVIDERS_FILE',
  'WEBCHAT_OIDC_REDIRECT_URI',
  'WEBCHAT_SESSION_SECRET',
  'WEBCHAT_SESSION_TTL_SECONDS',
  'WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS',
  'WEBCHAT_OIDC_ALLOWED_EMAILS',
  'WEBCHAT_OIDC_ALLOWED_SUBS',
  'WEBCHAT_OIDC_REQUIRED_GROUP',
  'WEBCHAT_BASIC_PASSWORD',
  'WEBCHAT_BASIC_ALLOWED_USERNAMES',
  'WEBCHAT_BASIC_DISPLAY_NAMES',
] as const;

function env(key: string, file: Record<string, string | undefined>): string | undefined {
  return process.env[key] || file[key];
}

function parseCsv(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDisplayNames(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of parseCsv(raw)) {
    const idx = entry.indexOf(':');
    if (idx <= 0) continue;
    const user = entry.slice(0, idx).trim().toLowerCase();
    const name = entry.slice(idx + 1).trim();
    if (user && name) map.set(user, name);
  }
  return map;
}

function loadProvidersJson(raw: string): OidcProviderConfig[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('WEBCHAT_OIDC_PROVIDERS must be a JSON array');
  return parsed.map(normalizeProvider);
}

function normalizeProvider(entry: unknown): OidcProviderConfig {
  if (!entry || typeof entry !== 'object') throw new Error('Invalid OIDC provider entry');
  const p = entry as Record<string, unknown>;
  const id = String(p.id ?? '').trim();
  const label = String(p.label ?? id).trim();
  const protocol = String(p.protocol ?? 'oidc') as OidcProviderProtocol;
  const clientId = String(p.clientId ?? '').trim();
  const clientSecret = String(p.clientSecret ?? '').trim();
  if (!id || !clientId || !clientSecret) {
    throw new Error(`OIDC provider "${id || '?'}" requires id, clientId, clientSecret`);
  }
  if (protocol !== 'oidc' && protocol !== 'oauth') {
    throw new Error(`OIDC provider "${id}" protocol must be oidc or oauth`);
  }
  const scopes = String(p.scopes ?? (protocol === 'oidc' ? 'openid profile email' : 'read:user user:email'));
  if (protocol === 'oidc') {
    const issuer = String(p.issuer ?? '').trim();
    if (!issuer) throw new Error(`OIDC provider "${id}" requires issuer`);
    return { id, label, protocol, issuer, clientId, clientSecret, scopes };
  }
  const authorizationUrl = String(p.authorizationUrl ?? '').trim();
  const tokenUrl = String(p.tokenUrl ?? '').trim();
  if (!authorizationUrl || !tokenUrl) {
    throw new Error(`OAuth provider "${id}" requires authorizationUrl and tokenUrl`);
  }
  const userInfoUrl = p.userInfoUrl ? String(p.userInfoUrl).trim() : undefined;
  return { id, label, protocol, authorizationUrl, tokenUrl, userInfoUrl, clientId, clientSecret, scopes };
}

function loadProviders(file: Record<string, string | undefined>): OidcProviderConfig[] {
  const inline = env('WEBCHAT_OIDC_PROVIDERS', file);
  if (inline?.trim()) return loadProvidersJson(inline);
  const path = env('WEBCHAT_OIDC_PROVIDERS_FILE', file);
  if (path?.trim()) {
    const raw = fs.readFileSync(path, 'utf8');
    return loadProvidersJson(raw);
  }
  return [];
}

/** Load adapter auth configuration from environment. */
export function loadWebAdapterAuthConfig(): WebAdapterAuthConfig | null {
  const file = readEnvFile([...ENV_KEYS]);
  const enabled = env('WEBCHAT_ENABLED', file);
  if (!enabled || enabled === 'false') return null;

  const authToken = env('WEBCHAT_SECRET', file);
  if (!authToken) return null;

  const modeRaw = env('WEBCHAT_AUTH_MODE', file) ?? 'local';
  const mode: WebchatAuthMode = modeRaw === 'public' ? 'public' : 'local';
  const bindAddress = env('WEBCHAT_BIND_ADDRESS', file) ?? '127.0.0.1';
  const localUserId = env('WEBCHAT_USER_ID', file) ?? 'web:local';
  const localDisplayName = env('WEBCHAT_DISPLAY_NAME', file) ?? 'Local';

  const base: WebAdapterAuthConfig = {
    mode,
    bindAddress,
    authToken,
    localUserId,
    localDisplayName,
  };

  if (mode === 'local') return base;

  const sessionSecret = env('WEBCHAT_SESSION_SECRET', file);
  if (!sessionSecret) {
    throw new Error('WEBCHAT_SESSION_SECRET is required when WEBCHAT_AUTH_MODE=public');
  }

  const oidcEnabled = env('WEBCHAT_AUTH_OIDC_ENABLED', file) === 'true';
  const basicEnabled = env('WEBCHAT_AUTH_BASIC_ENABLED', file) === 'true';
  if (!oidcEnabled && !basicEnabled) {
    throw new Error('Enable WEBCHAT_AUTH_OIDC_ENABLED and/or WEBCHAT_AUTH_BASIC_ENABLED for public mode');
  }

  const providers = oidcEnabled ? loadProviders(file) : [];
  if (oidcEnabled && providers.length === 0) {
    throw new Error('OIDC enabled but no providers configured (WEBCHAT_OIDC_PROVIDERS or _FILE)');
  }

  const redirectUri = env('WEBCHAT_OIDC_REDIRECT_URI', file);
  if (oidcEnabled && !redirectUri) {
    throw new Error('WEBCHAT_OIDC_REDIRECT_URI is required when OIDC is enabled');
  }

  const basicPassword = env('WEBCHAT_BASIC_PASSWORD', file) ?? '';
  const allowedUsernames = parseCsv(env('WEBCHAT_BASIC_ALLOWED_USERNAMES', file)).map((u) =>
    u.toLowerCase(),
  );
  if (basicEnabled) {
    if (!basicPassword) throw new Error('WEBCHAT_BASIC_PASSWORD is required when basic auth is enabled');
    if (allowedUsernames.length === 0) {
      throw new Error('WEBCHAT_BASIC_ALLOWED_USERNAMES is required when basic auth is enabled');
    }
  }

  const ttlRaw = env('WEBCHAT_SESSION_TTL_SECONDS', file);
  const sessionTtlSeconds = ttlRaw ? parseInt(ttlRaw, 10) : 86400;

  base.public = {
    sessionSecret,
    sessionTtlSeconds: Number.isFinite(sessionTtlSeconds) ? sessionTtlSeconds : 86400,
    redirectUri: redirectUri ?? '',
    oidcEnabled,
    providers,
    allowlist: {
      emailDomains: parseCsv(env('WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS', file)).map((d) => d.toLowerCase()),
      emails: parseCsv(env('WEBCHAT_OIDC_ALLOWED_EMAILS', file)).map((e) => e.toLowerCase()),
      subs: parseCsv(env('WEBCHAT_OIDC_ALLOWED_SUBS', file)),
      requiredGroup: env('WEBCHAT_OIDC_REQUIRED_GROUP', file)?.trim() || null,
    },
    basic: {
      enabled: basicEnabled,
      password: basicPassword,
      allowedUsernames,
      displayNames: parseDisplayNames(env('WEBCHAT_BASIC_DISPLAY_NAMES', file)),
    },
    secureCookies: process.env.NODE_ENV === 'production',
  };

  return base;
}

export function authConfigForTests(overrides: Partial<WebAdapterAuthConfig> = {}): WebAdapterAuthConfig {
  return {
    mode: 'local',
    bindAddress: '127.0.0.1',
    authToken: 'test-secret',
    localUserId: 'web:local',
    localDisplayName: 'Local',
    ...overrides,
  };
}

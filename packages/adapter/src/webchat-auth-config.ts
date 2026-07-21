/**
 * Public auth configuration from environment and OIDC providers JSON.
 */
import fs from 'fs';

import { readEnvFile } from './env.js';
import { log } from './log.js';

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

/**
 * Trust a parent-app session JWT carried in a cookie (same-site / shared domain).
 * Verified via JWKS; no knowledge of any specific host product.
 */
export interface ExternalSessionConfig {
  enabled: boolean;
  cookieName: string;
  jwksUrl: string;
  issuer: string;
  audience: string;
  userIdClaim: string;
  displayNameClaim: string;
  /** Prefixed onto the user-id claim to form webchat userId (e.g. `web:ext:`). */
  userIdPrefix: string;
}

export interface PublicAuthConfig {
  sessionSecret: string;
  sessionTtlSeconds: number;
  redirectUri: string;
  oidcEnabled: boolean;
  providers: OidcProviderConfig[];
  allowlist: OidcAllowlistConfig;
  basic: BasicAuthConfig;
  externalSession: ExternalSessionConfig;
  secureCookies: boolean;
}

export interface WebAdapterAuthConfig {
  mode: WebchatAuthMode;
  bindAddress: string;
  authToken: string;
  localUserId: string;
  localDisplayName: string;
  mcpHttpEnabled: boolean;
  publicBaseUrl?: string;
  /** MCP access-token TTL in seconds (default 86400). */
  mcpTokenTtlSeconds?: number;
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
  'WEBCHAT_SECURE_COOKIES',
  'WEBCHAT_SESSION_INSECURE_COOKIES',
  'WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS',
  'WEBCHAT_OIDC_ALLOWED_EMAILS',
  'WEBCHAT_OIDC_ALLOWED_SUBS',
  'WEBCHAT_OIDC_REQUIRED_GROUP',
  'WEBCHAT_BASIC_PASSWORD',
  'WEBCHAT_BASIC_ALLOWED_USERNAMES',
  'WEBCHAT_BASIC_DISPLAY_NAMES',
  'WEBCHAT_MCP_HTTP_ENABLED',
  'WEBCHAT_MCP_TOKEN_TTL_SECONDS',
  'WEBCHAT_PUBLIC_BASE_URL',
  'WEBCHAT_EXTERNAL_SESSION_ENABLED',
  'WEBCHAT_EXTERNAL_SESSION_COOKIE',
  'WEBCHAT_EXTERNAL_JWKS_URL',
  'WEBCHAT_EXTERNAL_JWT_ISS',
  'WEBCHAT_EXTERNAL_JWT_AUD',
  'WEBCHAT_EXTERNAL_USER_ID_CLAIM',
  'WEBCHAT_EXTERNAL_DISPLAY_NAME_CLAIM',
  'WEBCHAT_EXTERNAL_USER_ID_PREFIX',
] as const;

/** Minimum length for WEBCHAT_SESSION_SECRET (HMAC signing key). */
export const MIN_SESSION_SECRET_LENGTH = 32;

function resolvePublicBaseUrl(file: Record<string, string | undefined>): string | undefined {
  const explicit = env('WEBCHAT_PUBLIC_BASE_URL', file)?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const redirectUri = env('WEBCHAT_OIDC_REDIRECT_URI', file)?.trim();
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function resolveMcpHttpEnabled(
  mode: WebchatAuthMode,
  file: Record<string, string | undefined>,
): boolean {
  const raw = env('WEBCHAT_MCP_HTTP_ENABLED', file);
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return mode === 'public';
}

function resolveMcpTokenTtlSeconds(file: Record<string, string | undefined>): number {
  const raw = env('WEBCHAT_MCP_TOKEN_TTL_SECONDS', file);
  if (!raw) return 86_400;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 86_400;
}

function resolveSecureCookies(file: Record<string, string | undefined>): boolean {
  const explicit = env('WEBCHAT_SECURE_COOKIES', file);
  if (explicit === 'false') return false;
  if (explicit === 'true') return true;
  // Public mode defaults to Secure cookies; do not rely on NODE_ENV.
  return env('WEBCHAT_SESSION_INSECURE_COOKIES', file) !== 'true';
}

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
    mcpHttpEnabled: resolveMcpHttpEnabled(mode, file),
    publicBaseUrl: resolvePublicBaseUrl(file),
    mcpTokenTtlSeconds: resolveMcpTokenTtlSeconds(file),
  };

  if (mode === 'local') return base;

  const sessionSecret = env('WEBCHAT_SESSION_SECRET', file);
  if (!sessionSecret) {
    throw new Error('WEBCHAT_SESSION_SECRET is required when WEBCHAT_AUTH_MODE=public');
  }
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `WEBCHAT_SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters`,
    );
  }

  const oidcEnabled = env('WEBCHAT_AUTH_OIDC_ENABLED', file) === 'true';
  const basicEnabled = env('WEBCHAT_AUTH_BASIC_ENABLED', file) === 'true';
  const externalEnabled = env('WEBCHAT_EXTERNAL_SESSION_ENABLED', file) === 'true';
  if (!oidcEnabled && !basicEnabled && !externalEnabled) {
    throw new Error(
      'Enable WEBCHAT_AUTH_OIDC_ENABLED, WEBCHAT_AUTH_BASIC_ENABLED, and/or WEBCHAT_EXTERNAL_SESSION_ENABLED for public mode',
    );
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

  let externalSession: ExternalSessionConfig = {
    enabled: false,
    cookieName: '',
    jwksUrl: '',
    issuer: '',
    audience: '',
    userIdClaim: 'sub',
    displayNameClaim: 'name',
    userIdPrefix: 'web:ext:',
  };
  if (externalEnabled) {
    const cookieName = env('WEBCHAT_EXTERNAL_SESSION_COOKIE', file)?.trim() ?? '';
    const jwksUrl = env('WEBCHAT_EXTERNAL_JWKS_URL', file)?.trim() ?? '';
    const issuer = env('WEBCHAT_EXTERNAL_JWT_ISS', file)?.trim() ?? '';
    const audience = env('WEBCHAT_EXTERNAL_JWT_AUD', file)?.trim() ?? '';
    if (!cookieName) throw new Error('WEBCHAT_EXTERNAL_SESSION_COOKIE is required when external session is enabled');
    if (!jwksUrl) throw new Error('WEBCHAT_EXTERNAL_JWKS_URL is required when external session is enabled');
    if (!issuer) throw new Error('WEBCHAT_EXTERNAL_JWT_ISS is required when external session is enabled');
    if (!audience) throw new Error('WEBCHAT_EXTERNAL_JWT_AUD is required when external session is enabled');
    externalSession = {
      enabled: true,
      cookieName,
      jwksUrl,
      issuer,
      audience,
      userIdClaim: env('WEBCHAT_EXTERNAL_USER_ID_CLAIM', file)?.trim() || 'sub',
      displayNameClaim: env('WEBCHAT_EXTERNAL_DISPLAY_NAME_CLAIM', file)?.trim() || 'name',
      userIdPrefix: env('WEBCHAT_EXTERNAL_USER_ID_PREFIX', file)?.trim() || 'web:ext:',
    };
  }

  const ttlRaw = env('WEBCHAT_SESSION_TTL_SECONDS', file);
  const sessionTtlSeconds = ttlRaw ? parseInt(ttlRaw, 10) : 86400;

  if (base.mcpHttpEnabled && !base.publicBaseUrl) {
    throw new Error(
      'WEBCHAT_PUBLIC_BASE_URL (or WEBCHAT_OIDC_REDIRECT_URI with a valid origin) is required when MCP HTTP is enabled in public mode',
    );
  }

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
    externalSession,
    secureCookies: resolveSecureCookies(file),
  };

  if (
    (oidcEnabled || externalEnabled) &&
    base.public.allowlist.emailDomains.length === 0 &&
    base.public.allowlist.emails.length === 0 &&
    base.public.allowlist.subs.length === 0 &&
    base.public.allowlist.requiredGroup === null
  ) {
    log.warn(
      'Webchat public allowlist is empty: any account that completes OIDC or external session auth is admitted and granted global owner',
    );
  }

  return base;
}

export function authConfigForTests(overrides: Partial<WebAdapterAuthConfig> = {}): WebAdapterAuthConfig {
  return {
    mode: 'local',
    bindAddress: '127.0.0.1',
    authToken: 'test-secret',
    localUserId: 'web:local',
    localDisplayName: 'Local',
    mcpHttpEnabled: false,
    ...overrides,
  };
}

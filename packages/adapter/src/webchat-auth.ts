/**
 * Public auth HTTP handlers: OIDC/OAuth, basic login, session cookies.
 */
import crypto from 'crypto';
import http from 'http';

import type { OidcAllowlistConfig, OidcProviderConfig, PublicAuthConfig } from './webchat-auth-config.js';
import { verifyIdToken, isJwksRetryableVerificationError, type JsonWebKey } from './webchat-auth-jwt.js';
import { log } from './log.js';
import {
  clearSessionCookieHeader,
  consumeOAuthState,
  createSession,
  deleteSession,
  getSession,
  parseCookieHeader,
  parseSessionCookie,
  saveOAuthState,
  sessionCookieHeader,
  signSessionCookie,
  WEBCHAT_SESSION_COOKIE,
  type WebchatSessionUser,
} from './webchat-auth-sessions.js';

export interface AuthConfigResponse {
  basic: { enabled: boolean };
  providers: Array<{ id: string; label: string }>;
  /** Absent on older adapters that predate external-session auth. */
  externalSession?: { enabled: boolean };
}

export interface ResolvedWebUser {
  userId: string;
  displayName: string;
}

const MAX_LOGIN_BODY_BYTES = 4096;

function readLimitedBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    req.on('data', (chunk: Buffer | string) => {
      const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      bytes += size;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error('body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

type JsonResponder = (res: http.ServerResponse, status: number, data: unknown) => void;

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
}

const discoveryCache = new Map<string, OidcDiscovery>();
const jwksCache = new Map<string, JsonWebKey[]>();

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<unknown>;
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function getOidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const key = issuer.replace(/\/$/, '');
  const cached = discoveryCache.get(key);
  if (cached) return cached;
  const url = `${key}/.well-known/openid-configuration`;
  const doc = (await fetchJson(url)) as OidcDiscovery;
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error(`Invalid OIDC discovery document from ${url}`);
  }
  discoveryCache.set(key, doc);
  return doc;
}

async function fetchJwks(jwksUri: string): Promise<JsonWebKey[]> {
  const cached = jwksCache.get(jwksUri);
  if (cached) return cached;
  const doc = (await fetchJson(jwksUri)) as { keys?: JsonWebKey[] };
  const keys = doc.keys ?? [];
  if (keys.length === 0) throw new Error(`No keys in JWKS from ${jwksUri}`);
  jwksCache.set(jwksUri, keys);
  return keys;
}

async function verifyOidcIdToken(idToken: string, provider: OidcProviderConfig): Promise<Record<string, unknown>> {
  if (provider.protocol !== 'oidc' || !provider.issuer) {
    throw new Error('OIDC issuer required to verify id_token');
  }
  const discovery = await getOidcDiscovery(provider.issuer);
  if (!discovery.jwks_uri) throw new Error('OIDC discovery missing jwks_uri');
  const jwksUri = discovery.jwks_uri;
  const verifyOpts = {
    audience: provider.clientId,
    issuer: provider.issuer,
  };

  const verifyWithKeys = (keys: JsonWebKey[]) => verifyIdToken(idToken, keys, verifyOpts);

  let keys = await fetchJwks(jwksUri);
  try {
    return verifyWithKeys(keys);
  } catch (err) {
    if (!isJwksRetryableVerificationError(err)) throw err;
    jwksCache.delete(jwksUri);
    keys = await fetchJwks(jwksUri);
    return verifyWithKeys(keys);
  }
}

/** @internal test helper */
export async function verifyOidcIdTokenForTests(
  idToken: string,
  provider: OidcProviderConfig,
): Promise<Record<string, unknown>> {
  return verifyOidcIdToken(idToken, provider);
}

/** @internal test helper */
export function resetWebchatAuthCachesForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

function hasAllowlistRules(allowlist: OidcAllowlistConfig): boolean {
  return (
    allowlist.emailDomains.length > 0 ||
    allowlist.emails.length > 0 ||
    allowlist.subs.length > 0 ||
    allowlist.requiredGroup !== null
  );
}

function groupsFromClaims(claims: Record<string, unknown>): string[] {
  const groups = claims.groups;
  if (Array.isArray(groups)) return groups.map(String);
  if (typeof groups === 'string') return groups.split(',').map((g) => g.trim());
  return [];
}

export function checkOidcAllowlist(
  allowlist: OidcAllowlistConfig,
  providerId: string,
  claims: Record<string, unknown>,
): boolean {
  if (!hasAllowlistRules(allowlist)) return true;

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : '';
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const sub = String(claims.sub ?? '');
  const subKey = `${providerId}:${sub}`;

  let allowed = false;
  if (allowlist.emailDomains.length > 0 && email && emailVerified) {
    const domain = email.split('@')[1];
    if (domain && allowlist.emailDomains.includes(domain.toLowerCase())) allowed = true;
  }
  if (allowlist.emails.length > 0 && email && emailVerified && allowlist.emails.includes(email)) {
    allowed = true;
  }
  if (allowlist.subs.length > 0 && allowlist.subs.includes(subKey)) allowed = true;

  if (!allowed) return false;

  if (allowlist.requiredGroup) {
    const groups = groupsFromClaims(claims);
    if (!groups.includes(allowlist.requiredGroup)) return false;
  }

  return true;
}

function identityFromOidcClaims(
  providerId: string,
  claims: Record<string, unknown>,
  fallbackLogin?: string,
): WebchatSessionUser {
  const sub = String(claims.sub ?? '');
  const name =
    (typeof claims.name === 'string' && claims.name.trim()) ||
    (typeof claims.preferred_username === 'string' && claims.preferred_username.trim()) ||
    (fallbackLogin ? `@${fallbackLogin}` : sub);
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  return {
    userId: `web:${providerId}:${sub}`,
    displayName: name,
    authMethod: 'oidc',
    providerId,
    email,
    oidcSub: sub,
  };
}

async function fetchGitHubProfile(accessToken: string): Promise<{ claims: Record<string, unknown>; login: string }> {
  const user = (await fetchJson('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'nanoclaw-webchat' },
  })) as Record<string, unknown>;
  const login = String(user.login ?? '');
  let email = typeof user.email === 'string' ? user.email : '';
  let emailVerified = Boolean(email);
  if (!email) {
    const emails = (await fetchJson('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'nanoclaw-webchat' },
    })) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (primary) {
      email = primary.email;
      emailVerified = primary.verified;
    }
  }
  return {
    login,
    claims: {
      sub: String(user.id ?? ''),
      name: user.name,
      email,
      email_verified: emailVerified,
    },
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  // Hash to fixed-length digests so timingSafeEqual never early-returns on length
  // (which would leak allowlist/password length information).
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAllowedUsername(allowedUsernames: string[], normalized: string): boolean {
  let allowed = false;
  for (const candidate of allowedUsernames) {
    if (constantTimeEqual(normalized, candidate)) allowed = true;
  }
  return allowed;
}

export function validateBasicLogin(
  config: PublicAuthConfig,
  username: string,
  password: string,
): WebchatSessionUser | null {
  if (!config.basic.enabled) return null;
  const normalized = username.trim().toLowerCase();
  // Run both comparisons unconditionally so response timing does not reveal
  // whether the username was in the allowlist (no early return on username miss).
  const usernameAllowed = !!normalized && isAllowedUsername(config.basic.allowedUsernames, normalized);
  const passwordOk = constantTimeEqual(password, config.basic.password);
  if (!usernameAllowed || !passwordOk) return null;
  const displayName = config.basic.displayNames.get(normalized) ?? username.trim();
  return {
    userId: `web:basic:${normalized}`,
    displayName,
    authMethod: 'basic',
  };
}

export function buildAuthConfigResponse(config: PublicAuthConfig): AuthConfigResponse {
  return {
    basic: { enabled: config.basic.enabled },
    providers: config.oidcEnabled
      ? config.providers.map((p) => ({ id: p.id, label: p.label || `Login with ${p.id}` }))
      : [],
    externalSession: { enabled: config.externalSession.enabled },
  };
}

export function resolveSessionUser(
  config: PublicAuthConfig,
  req: http.IncomingMessage,
): ResolvedWebUser | null {
  const raw = parseCookieHeader(req.headers.cookie, WEBCHAT_SESSION_COOKIE);
  const sessionId = parseSessionCookie(raw, config.sessionSecret);
  if (!sessionId) return null;
  const session = getSession(sessionId);
  if (!session) return null;
  return { userId: session.userId, displayName: session.displayName };
}

/** Stable provider id used in allowlist `subs` entries (`ext:<sub>`). */
export const EXTERNAL_SESSION_PROVIDER_ID = 'ext';

function identityFromExternalClaims(
  config: PublicAuthConfig,
  claims: Record<string, unknown>,
): WebchatSessionUser {
  const ext = config.externalSession;
  const idRaw = claims[ext.userIdClaim];
  const idPart = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw).trim() : '';
  if (!idPart) throw new Error(`External JWT missing ${ext.userIdClaim} claim`);

  const nameRaw = claims[ext.displayNameClaim];
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const preferred =
    typeof claims.preferred_username === 'string' ? claims.preferred_username : undefined;
  const displayName =
    (typeof nameRaw === 'string' && nameRaw.trim()) ||
    email ||
    preferred ||
    idPart;

  return {
    userId: `${ext.userIdPrefix}${idPart}`,
    displayName,
    authMethod: 'external',
    providerId: EXTERNAL_SESSION_PROVIDER_ID,
    email,
    oidcSub: typeof claims.sub === 'string' ? claims.sub : idPart,
  };
}

/**
 * Verify the configured external session cookie JWT. Does not mint a webchat_session.
 * Returns null when external auth is disabled, cookie missing, or verification fails.
 */
export async function verifyExternalSessionUser(
  config: PublicAuthConfig,
  req: http.IncomingMessage,
): Promise<WebchatSessionUser | null> {
  const ext = config.externalSession;
  if (!ext.enabled) return null;

  const raw = parseCookieHeader(req.headers.cookie, ext.cookieName);
  if (!raw?.trim()) return null;

  try {
    const verifyOpts = { audience: ext.audience, issuer: ext.issuer };
    const verifyWithKeys = (keys: JsonWebKey[]) => verifyIdToken(raw, keys, verifyOpts);

    let keys = await fetchJwks(ext.jwksUrl);
    let claims: Record<string, unknown>;
    try {
      claims = verifyWithKeys(keys);
    } catch (err) {
      if (!isJwksRetryableVerificationError(err)) throw err;
      jwksCache.delete(ext.jwksUrl);
      keys = await fetchJwks(ext.jwksUrl);
      claims = verifyWithKeys(keys);
    }

    // Resolve the configured identity claim first so allowlist `ext:<…>` keys match the
    // same value used for the minted webchat userId (WEBCHAT_EXTERNAL_USER_ID_CLAIM).
    const idRaw = claims[ext.userIdClaim];
    const idPart = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw).trim() : '';
    if (!idPart) throw new Error(`External JWT missing ${ext.userIdClaim} claim`);

    // Trust boundary: parent session JWTs are already authenticated by the host IdP.
    // Treat email as verified for allowlist domain/email checks — we assume the host
    // never emits an unverified email inside a signature-verified session token.
    const allowlistClaims: Record<string, unknown> = {
      ...claims,
      sub: idPart,
      email_verified: true,
    };
    if (!checkOidcAllowlist(config.allowlist, EXTERNAL_SESSION_PROVIDER_ID, allowlistClaims)) {
      log.warn('Webchat external session rejected by allowlist', {
        sub: idPart,
        userIdClaim: ext.userIdClaim,
      });
      return null;
    }

    return identityFromExternalClaims(config, claims);
  } catch (err) {
    log.debug('Webchat external session verification failed', { err });
    return null;
  }
}

/**
 * If there is no webchat_session yet, verify the external cookie and mint one.
 * When `res` is provided, sets `Set-Cookie`. Returns the established user or null.
 */
export async function tryEstablishExternalSession(
  config: PublicAuthConfig,
  req: http.IncomingMessage,
  onLogin: (user: WebchatSessionUser) => void,
  res?: http.ServerResponse,
): Promise<ResolvedWebUser | null> {
  const existing = resolveSessionUser(config, req);
  if (existing) return existing;
  const user = await verifyExternalSessionUser(config, req);
  if (!user) return null;
  try {
    onLogin(user);
  } catch (err) {
    log.error('Webchat external session onLogin failed', { err, userId: user.userId });
    return null;
  }
  if (res) {
    writeSession(res, config, user);
  }
  return { userId: user.userId, displayName: user.displayName };
}

function writeSession(res: http.ServerResponse, config: PublicAuthConfig, user: WebchatSessionUser): void {
  const record = createSession(user, config.sessionTtlSeconds);
  const signed = signSessionCookie(record.id, config.sessionSecret);
  res.setHeader(
    'Set-Cookie',
    sessionCookieHeader(signed, { secure: config.secureCookies, maxAgeSeconds: config.sessionTtlSeconds }),
  );
}

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

import { normalizeWebchatPublicPath } from './webchat-public-path.js';

/** Normalize public path prefix for home redirects and Back links (empty → `/`). */
function webchatHomePath(publicPath?: string): string {
  const normalized = normalizeWebchatPublicPath(publicPath);
  return normalized ? `${normalized}/` : '/';
}

function htmlPage(res: http.ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`,
  );
}

async function startOidcLogin(
  res: http.ServerResponse,
  config: PublicAuthConfig,
  provider: OidcProviderConfig,
): Promise<void> {
  const { verifier, challenge } = generatePkce();
  const state = base64Url(crypto.randomBytes(24));
  saveOAuthState(state, provider.id, verifier);

  let authorizeUrl: URL;
  if (provider.protocol === 'oidc') {
    const discovery = await getOidcDiscovery(provider.issuer!);
    authorizeUrl = new URL(discovery.authorization_endpoint);
  } else {
    authorizeUrl = new URL(provider.authorizationUrl!);
  }

  authorizeUrl.searchParams.set('client_id', provider.clientId);
  authorizeUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', provider.scopes);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  redirect(res, authorizeUrl.toString());
}

async function exchangeCode(
  config: PublicAuthConfig,
  provider: OidcProviderConfig,
  code: string,
  codeVerifier: string,
): Promise<WebchatSessionUser> {
  let tokenUrl: string;
  if (provider.protocol === 'oidc') {
    const discovery = await getOidcDiscovery(provider.issuer!);
    tokenUrl = discovery.token_endpoint;
  } else {
    tokenUrl = provider.tokenUrl!;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text().catch(() => '');
    throw new Error(`Token exchange failed: ${text.slice(0, 200)}`);
  }
  const tokens = (await tokenRes.json()) as Record<string, unknown>;

  if (provider.protocol === 'oauth' && provider.id === 'github') {
    const accessToken = String(tokens.access_token ?? '');
    const { claims, login } = await fetchGitHubProfile(accessToken);
    if (!checkOidcAllowlist(config.allowlist, provider.id, claims)) {
      throw new AllowlistError();
    }
    return identityFromOidcClaims(provider.id, claims, login);
  }

  const idToken = typeof tokens.id_token === 'string' ? tokens.id_token : null;
  if (!idToken) throw new Error('Missing id_token');
  const claims = await verifyOidcIdToken(idToken, provider);
  if (!checkOidcAllowlist(config.allowlist, provider.id, claims)) {
    throw new AllowlistError();
  }
  return identityFromOidcClaims(provider.id, claims);
}

export class AllowlistError extends Error {
  constructor() {
    super('Access denied');
    this.name = 'AllowlistError';
  }
}

export async function handlePublicAuthRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  config: PublicAuthConfig,
  json: JsonResponder,
  onLogin: (user: WebchatSessionUser) => void,
  /** Public path prefix (e.g. `/webchat`) for post-login redirect under a stripPrefix mount. */
  publicPath?: string,
): Promise<boolean> {
  if (url.pathname === '/api/auth/config' && req.method === 'GET') {
    json(res, 200, buildAuthConfigResponse(config));
    return true;
  }

  if (url.pathname === '/api/auth/me' && req.method === 'GET') {
    let user = resolveSessionUser(config, req);
    if (!user) {
      user = await tryEstablishExternalSession(config, req, onLogin, res);
    }
    if (!user) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }
    json(res, 200, user);
    return true;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    const raw = parseCookieHeader(req.headers.cookie, WEBCHAT_SESSION_COOKIE);
    const sessionId = parseSessionCookie(raw, config.sessionSecret);
    if (sessionId) deleteSession(sessionId);
    res.setHeader('Set-Cookie', clearSessionCookieHeader(config.secureCookies));
    json(res, 200, { ok: true });
    return true;
  }

  if (url.pathname === '/api/auth/login/basic' && req.method === 'POST') {
    let body: string;
    try {
      body = await readLimitedBody(req, MAX_LOGIN_BODY_BYTES);
    } catch {
      json(res, 413, { error: 'payload too large' });
      return true;
    }
    let parsed: { username?: string; password?: string };
    try {
      parsed = JSON.parse(body) as { username?: string; password?: string };
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const user = validateBasicLogin(config, parsed.username ?? '', parsed.password ?? '');
    if (!user) {
      json(res, 401, { error: 'Invalid username or password' });
      return true;
    }
    // Wire before Set-Cookie so a wiring/db failure cannot leave a usable session cookie.
    try {
      onLogin(user);
    } catch (err) {
      log.error('Webchat basic login onLogin failed', { err, userId: user.userId });
      json(res, 500, { error: 'Login failed' });
      return true;
    }
    writeSession(res, config, user);
    json(res, 200, { ok: true, user: { id: user.userId, displayName: user.displayName } });
    return true;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'GET') {
    if (!config.oidcEnabled) {
      json(res, 404, { error: 'Not found' });
      return true;
    }
    const providerId = url.searchParams.get('provider') ?? '';
    const provider = config.providers.find((p) => p.id === providerId);
    if (!provider) {
      json(res, 400, { error: 'Unknown provider' });
      return true;
    }
    await startOidcLogin(res, config, provider);
    return true;
  }

  if (url.pathname === '/api/auth/callback' && req.method === 'GET') {
    if (!config.oidcEnabled) {
      json(res, 404, { error: 'Not found' });
      return true;
    }
    const home = webchatHomePath(publicPath);
    const backLink = `<p><a href="${home}">Back</a></p>`;
    const err = url.searchParams.get('error');
    if (err) {
      htmlPage(res, 403, 'Access denied', `<h1>Login cancelled</h1>${backLink}`);
      return true;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      htmlPage(res, 400, 'Bad request', '<h1>Invalid callback</h1>');
      return true;
    }
    const oauthState = consumeOAuthState(state);
    if (!oauthState) {
      htmlPage(res, 400, 'Bad request', '<h1>Invalid or expired login state</h1>');
      return true;
    }
    const provider = config.providers.find((p) => p.id === oauthState.providerId);
    if (!provider) {
      htmlPage(res, 400, 'Bad request', '<h1>Unknown provider</h1>');
      return true;
    }
    try {
      const user = await exchangeCode(config, provider, code, oauthState.codeVerifier);
      // Wire before Set-Cookie so a wiring/db failure cannot leave a usable session cookie.
      onLogin(user);
      writeSession(res, config, user);
      redirect(res, home);
    } catch (e) {
      if (e instanceof AllowlistError) {
        htmlPage(
          res,
          403,
          'Access denied',
          `<h1>Access denied</h1><p>Your account is not authorized for this webchat.</p>${backLink}`,
        );
        return true;
      }
      log.error('Webchat OIDC login failed', { err: e });
      htmlPage(res, 500, 'Login failed', `<h1>Login failed</h1>${backLink}`);
    }
    return true;
  }

  return false;
}

export function isPublicAuthPath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/');
}

export function isPublicAuthExemptPath(pathname: string): boolean {
  return pathname === '/api/auth/config' || pathname === '/api/auth/login' || pathname === '/api/auth/callback';
}

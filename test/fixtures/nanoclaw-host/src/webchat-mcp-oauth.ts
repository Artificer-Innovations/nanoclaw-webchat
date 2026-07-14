/**
 * MCP OAuth authorization server backend: client registration, auth codes, JWT access tokens.
 */
import crypto from 'crypto';
import http from 'http';

import type { PublicAuthConfig } from './webchat-auth-config.js';
import { resolveSessionUser } from './webchat-auth.js';
import { ensureWebchatAuthSchema, getAuthDbInternal } from './webchat-auth-sessions.js';

export const MCP_ACCESS_TOKEN_TTL_SECONDS = 3600;
export const MCP_DEFAULT_SCOPE = 'mcp:tools';

export interface McpAccessTokenUser {
  userId: string;
  displayName: string;
  clientId: string;
  scopes: string[];
  resource?: string;
}

export interface McpOAuthClientRecord {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
}

export interface McpAuthorizationParams {
  state?: string;
  scopes: string[];
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
}

export interface McpOAuthTokens {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  scope: string;
}

export interface WebchatMcpOAuthConfig {
  publicAuth: PublicAuthConfig;
  publicBaseUrl: string;
  resourceServerUrl: string;
  tokenTtlSeconds?: number;
}

interface JwtPayload {
  sub: string;
  name: string;
  aud: string;
  scope: string;
  client_id: string;
  exp: number;
  iat: number;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signJwt(payload: JwtPayload, secret: string): string {
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = base64UrlJson(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as JwtPayload;
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function purgeExpiredMcpCodes(): void {
  const db = getAuthDbInternal();
  const cutoff = Date.now() - 10 * 60 * 1000;
  db.prepare('DELETE FROM web_mcp_oauth_codes WHERE created_at_ms < ?').run(cutoff);
}

function rowToClient(row: {
  client_id: string;
  client_secret: string | null;
  client_id_issued_at: number;
  client_secret_expires_at: number | null;
  redirect_uris_json: string;
  client_name: string | null;
  token_endpoint_auth_method: string | null;
  grant_types_json: string | null;
  response_types_json: string | null;
  scope: string | null;
}): McpOAuthClientRecord {
  return {
    client_id: row.client_id,
    client_secret: row.client_secret ?? undefined,
    client_id_issued_at: row.client_id_issued_at,
    client_secret_expires_at: row.client_secret_expires_at ?? undefined,
    redirect_uris: JSON.parse(row.redirect_uris_json) as string[],
    client_name: row.client_name ?? undefined,
    token_endpoint_auth_method: row.token_endpoint_auth_method ?? undefined,
    grant_types: row.grant_types_json ? (JSON.parse(row.grant_types_json) as string[]) : undefined,
    response_types: row.response_types_json
      ? (JSON.parse(row.response_types_json) as string[])
      : undefined,
    scope: row.scope ?? undefined,
  };
}

export function ensureWebchatMcpOAuthSchema(): void {
  ensureWebchatAuthSchema();
}

export function verifyMcpAccessToken(
  token: string,
  config: Pick<WebchatMcpOAuthConfig, 'publicAuth' | 'resourceServerUrl'>,
): McpAccessTokenUser | null {
  const payload = verifyJwt(token, config.publicAuth.sessionSecret);
  if (!payload) return null;
  if (payload.aud !== config.resourceServerUrl) return null;
  const scopes = payload.scope ? payload.scope.split(' ').filter(Boolean) : [MCP_DEFAULT_SCOPE];
  return {
    userId: payload.sub,
    displayName: payload.name,
    clientId: payload.client_id,
    scopes,
    resource: payload.aud,
  };
}

export function createWebchatMcpOAuthBackend(config: WebchatMcpOAuthConfig) {
  ensureWebchatMcpOAuthSchema();
  const tokenTtlSeconds = config.tokenTtlSeconds ?? MCP_ACCESS_TOKEN_TTL_SECONDS;

  const clientsStore = {
    async getClient(clientId: string): Promise<McpOAuthClientRecord | undefined> {
      const db = getAuthDbInternal();
      const row = db
        .prepare(
          `SELECT client_id, client_secret, client_id_issued_at, client_secret_expires_at,
                  redirect_uris_json, client_name, token_endpoint_auth_method,
                  grant_types_json, response_types_json, scope
           FROM web_mcp_oauth_clients WHERE client_id = ?`,
        )
        .get(clientId) as
        | {
            client_id: string;
            client_secret: string | null;
            client_id_issued_at: number;
            client_secret_expires_at: number | null;
            redirect_uris_json: string;
            client_name: string | null;
            token_endpoint_auth_method: string | null;
            grant_types_json: string | null;
            response_types_json: string | null;
            scope: string | null;
          }
        | undefined;
      return row ? rowToClient(row) : undefined;
    },

    async registerClient(
      client: Omit<McpOAuthClientRecord, 'client_id'> & { client_id?: string },
    ): Promise<McpOAuthClientRecord> {
      const db = getAuthDbInternal();
      const clientId = client.client_id ?? crypto.randomUUID();
      const issuedAt = client.client_id_issued_at ?? Math.floor(Date.now() / 1000);
      const record: McpOAuthClientRecord = {
        ...client,
        client_id: clientId,
        client_id_issued_at: issuedAt,
        redirect_uris: client.redirect_uris.map(String),
      };
      db.prepare(
        `INSERT INTO web_mcp_oauth_clients
         (client_id, client_secret, client_id_issued_at, client_secret_expires_at,
          redirect_uris_json, client_name, token_endpoint_auth_method,
          grant_types_json, response_types_json, scope)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        record.client_id,
        record.client_secret ?? null,
        record.client_id_issued_at!,
        record.client_secret_expires_at ?? null,
        JSON.stringify(record.redirect_uris),
        record.client_name ?? null,
        record.token_endpoint_auth_method ?? null,
        record.grant_types ? JSON.stringify(record.grant_types) : null,
        record.response_types ? JSON.stringify(record.response_types) : null,
        record.scope ?? null,
      );
      return record;
    },
  };

  return {
    clientsStore,
    config,

    buildAuthorizeReturnUrl(req: http.IncomingMessage & { originalUrl?: string | null }): string {
      const path = req.originalUrl ?? req.url ?? '/authorize';
      return new URL(path, `${config.publicBaseUrl}/`).toString();
    },

    authorize(
      req: http.IncomingMessage,
      client: McpOAuthClientRecord,
      params: McpAuthorizationParams,
    ): { type: 'redirect'; location: string } {
      const session = resolveSessionUser(config.publicAuth, req);
      if (!session) {
        const returnTo = this.buildAuthorizeReturnUrl(req);
        return {
          type: 'redirect',
          location: `/?returnTo=${encodeURIComponent(returnTo)}`,
        };
      }

      if (!client.redirect_uris.includes(params.redirectUri)) {
        throw new Error('Unregistered redirect_uri');
      }

      if (params.resource && params.resource !== config.resourceServerUrl) {
        throw new Error('Invalid resource');
      }

      const code = crypto.randomBytes(32).toString('hex');
      purgeExpiredMcpCodes();
      const db = getAuthDbInternal();
      db.prepare(
        `INSERT INTO web_mcp_oauth_codes
         (code, client_id, user_id, display_name, code_challenge, redirect_uri, scopes_json, resource, state, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        code,
        client.client_id,
        session.userId,
        session.displayName,
        params.codeChallenge,
        params.redirectUri,
        JSON.stringify(params.scopes.length ? params.scopes : [MCP_DEFAULT_SCOPE]),
        params.resource ?? config.resourceServerUrl,
        params.state ?? null,
        Date.now(),
      );

      const target = new URL(params.redirectUri);
      target.searchParams.set('code', code);
      if (params.state) target.searchParams.set('state', params.state);
      return { type: 'redirect', location: target.toString() };
    },

    async challengeForAuthorizationCode(_client: McpOAuthClientRecord, code: string): Promise<string> {
      purgeExpiredMcpCodes();
      const db = getAuthDbInternal();
      const row = db
        .prepare(`SELECT code_challenge FROM web_mcp_oauth_codes WHERE code = ?`)
        .get(code) as { code_challenge: string } | undefined;
      if (!row) throw new Error('Invalid authorization code');
      return row.code_challenge;
    },

    async exchangeAuthorizationCode(
      client: McpOAuthClientRecord,
      authorizationCode: string,
      resource?: string,
    ): Promise<McpOAuthTokens> {
      purgeExpiredMcpCodes();
      const db = getAuthDbInternal();
      const row = db
        .prepare(
          `SELECT client_id, user_id, display_name, redirect_uri, scopes_json, resource
           FROM web_mcp_oauth_codes WHERE code = ?`,
        )
        .get(authorizationCode) as
        | {
            client_id: string;
            user_id: string;
            display_name: string;
            redirect_uri: string;
            scopes_json: string;
            resource: string | null;
          }
        | undefined;
      if (!row) throw new Error('Invalid authorization code');
      if (row.client_id !== client.client_id) {
        throw new Error('Authorization code was not issued to this client');
      }
      const expectedResource = resource ?? row.resource ?? config.resourceServerUrl;
      if (expectedResource !== config.resourceServerUrl) {
        throw new Error('Invalid resource');
      }
      db.prepare('DELETE FROM web_mcp_oauth_codes WHERE code = ?').run(authorizationCode);

      const scopes = JSON.parse(row.scopes_json) as string[];
      const now = Math.floor(Date.now() / 1000);
      const payload: JwtPayload = {
        sub: row.user_id,
        name: row.display_name,
        aud: config.resourceServerUrl,
        scope: scopes.join(' '),
        client_id: client.client_id,
        iat: now,
        exp: now + tokenTtlSeconds,
      };
      const accessToken = signJwt(payload, config.publicAuth.sessionSecret);
      return {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: tokenTtlSeconds,
        scope: scopes.join(' '),
      };
    },

    verifyAccessToken(token: string): McpAccessTokenUser | null {
      return verifyMcpAccessToken(token, config);
    },
  };
}

export type WebchatMcpOAuthBackend = ReturnType<typeof createWebchatMcpOAuthBackend>;

/** @internal test helper */
export function resetWebchatMcpOAuthForTests(): void {
  ensureWebchatMcpOAuthSchema();
  const db = getAuthDbInternal();
  db.exec('DELETE FROM web_mcp_oauth_clients; DELETE FROM web_mcp_oauth_codes;');
}

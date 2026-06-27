/**
 * Session and OAuth state persistence in webchat.db.
 */
import crypto from 'crypto';

import Database from 'better-sqlite3';

import { webchatDbPath } from './webchat-store.js';

export const WEBCHAT_SESSION_COOKIE = 'webchat_session';

export interface WebchatSessionRecord {
  id: string;
  userId: string;
  displayName: string;
  authMethod: 'oidc' | 'basic';
  providerId: string | null;
  email: string | null;
  oidcSub: string | null;
  expiresAtMs: number;
  createdAtMs: number;
}

export interface WebchatSessionUser {
  userId: string;
  displayName: string;
  authMethod: 'oidc' | 'basic';
  providerId?: string;
  email?: string;
  oidcSub?: string;
}

const AUTH_SCHEMA = `
CREATE TABLE IF NOT EXISTS web_sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  auth_method   TEXT NOT NULL,
  provider_id   TEXT,
  email         TEXT,
  oidc_sub      TEXT,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at_ms);

CREATE TABLE IF NOT EXISTS web_oauth_states (
  state           TEXT PRIMARY KEY,
  provider_id     TEXT NOT NULL,
  code_verifier   TEXT NOT NULL,
  created_at_ms   INTEGER NOT NULL
);
`;

let schemaReady = false;

function openAuthDb(): Database.Database {
  const db = new Database(webchatDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  if (!schemaReady) {
    db.exec(AUTH_SCHEMA);
    schemaReady = true;
  }
  return db;
}

export function ensureWebchatAuthSchema(): void {
  const db = openAuthDb();
  db.close();
}

export function createSession(user: WebchatSessionUser, ttlSeconds: number): WebchatSessionRecord {
  const db = openAuthDb();
  try {
    const now = Date.now();
    const id = crypto.randomBytes(32).toString('hex');
    const record: WebchatSessionRecord = {
      id,
      userId: user.userId,
      displayName: user.displayName,
      authMethod: user.authMethod,
      providerId: user.providerId ?? null,
      email: user.email ?? null,
      oidcSub: user.oidcSub ?? null,
      expiresAtMs: now + ttlSeconds * 1000,
      createdAtMs: now,
    };
    db.prepare(
      `INSERT INTO web_sessions
       (id, user_id, display_name, auth_method, provider_id, email, oidc_sub, expires_at_ms, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.userId,
      record.displayName,
      record.authMethod,
      record.providerId,
      record.email,
      record.oidcSub,
      record.expiresAtMs,
      record.createdAtMs,
    );
    return record;
  } finally {
    db.close();
  }
}

export function getSession(sessionId: string): WebchatSessionRecord | null {
  const db = openAuthDb();
  try {
    purgeExpiredSessions(db);
    const row = db
      .prepare(
        `SELECT id, user_id, display_name, auth_method, provider_id, email, oidc_sub, expires_at_ms, created_at_ms
         FROM web_sessions WHERE id = ?`,
      )
      .get(sessionId) as
      | {
          id: string;
          user_id: string;
          display_name: string;
          auth_method: string;
          provider_id: string | null;
          email: string | null;
          oidc_sub: string | null;
          expires_at_ms: number;
          created_at_ms: number;
        }
      | undefined;
    if (!row) return null;
    if (row.expires_at_ms <= Date.now()) {
      db.prepare('DELETE FROM web_sessions WHERE id = ?').run(sessionId);
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      authMethod: row.auth_method as 'oidc' | 'basic',
      providerId: row.provider_id,
      email: row.email,
      oidcSub: row.oidc_sub,
      expiresAtMs: row.expires_at_ms,
      createdAtMs: row.created_at_ms,
    };
  } finally {
    db.close();
  }
}

export function deleteSession(sessionId: string): void {
  const db = openAuthDb();
  try {
    db.prepare('DELETE FROM web_sessions WHERE id = ?').run(sessionId);
  } finally {
    db.close();
  }
}

function purgeExpiredSessions(db: Database.Database): void {
  db.prepare('DELETE FROM web_sessions WHERE expires_at_ms <= ?').run(Date.now());
}

export function saveOAuthState(state: string, providerId: string, codeVerifier: string): void {
  const db = openAuthDb();
  try {
    purgeOAuthStates(db);
    db.prepare(
      `INSERT INTO web_oauth_states (state, provider_id, code_verifier, created_at_ms) VALUES (?, ?, ?, ?)`,
    ).run(state, providerId, codeVerifier, Date.now());
  } finally {
    db.close();
  }
}

export interface OAuthStateRecord {
  providerId: string;
  codeVerifier: string;
}

export function consumeOAuthState(state: string): OAuthStateRecord | null {
  const db = openAuthDb();
  try {
    purgeOAuthStates(db);
    const row = db
      .prepare(`SELECT provider_id, code_verifier, created_at_ms FROM web_oauth_states WHERE state = ?`)
      .get(state) as { provider_id: string; code_verifier: string; created_at_ms: number } | undefined;
    if (!row) return null;
    if (Date.now() - row.created_at_ms > 10 * 60 * 1000) {
      db.prepare('DELETE FROM web_oauth_states WHERE state = ?').run(state);
      return null;
    }
    db.prepare('DELETE FROM web_oauth_states WHERE state = ?').run(state);
    return { providerId: row.provider_id, codeVerifier: row.code_verifier };
  } finally {
    db.close();
  }
}

function purgeOAuthStates(db: Database.Database): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  db.prepare('DELETE FROM web_oauth_states WHERE created_at_ms < ?').run(cutoff);
}

export function signSessionCookie(sessionId: string, secret: string): string {
  const sig = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${sig}`;
}

export function parseSessionCookie(raw: string | undefined, secret: string): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const sessionId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return sessionId;
}

export function parseCookieHeader(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return undefined;
}

export function sessionCookieHeader(
  value: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${WEBCHAT_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = [`${WEBCHAT_SESSION_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** @internal test helper */
export function resetWebchatAuthSchemaForTests(): void {
  schemaReady = false;
}

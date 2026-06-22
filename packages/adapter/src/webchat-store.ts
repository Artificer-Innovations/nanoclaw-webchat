/**
 * Durable web chat UI history — threads and messages in data/webchat.db.
 * Single writer: web channel adapter. Not agent session workload.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { DATA_DIR } from './config.js';

export const MAIN_THREAD = 'main';

const WEBCHAT_SCHEMA = `
CREATE TABLE IF NOT EXISTS web_threads (
  platform_id  TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (platform_id, thread_id)
);

CREATE TABLE IF NOT EXISTS web_messages (
  id               TEXT PRIMARY KEY,
  platform_id      TEXT NOT NULL,
  thread_id        TEXT NOT NULL,
  direction        TEXT NOT NULL,
  text             TEXT NOT NULL,
  timestamp_ms     INTEGER NOT NULL,
  sender_name      TEXT,
  attachments_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_web_messages_thread
  ON web_messages(platform_id, thread_id, timestamp_ms);

CREATE TABLE IF NOT EXISTS web_thread_engaged (
  platform_id  TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  agent_folder TEXT NOT NULL,
  engaged_at   INTEGER NOT NULL,
  PRIMARY KEY (platform_id, thread_id, agent_folder)
);

CREATE TABLE IF NOT EXISTS web_thread_backfill_delivered (
  platform_id   TEXT NOT NULL,
  thread_id     TEXT NOT NULL,
  agent_folder  TEXT NOT NULL,
  delivered_at  INTEGER NOT NULL,
  PRIMARY KEY (platform_id, thread_id, agent_folder)
);
`;

/** Applied after thread_seq column migration (existing DBs lack the column until ALTER). */
const WEBCHAT_THREAD_SEQ_SCHEMA = `
CREATE TABLE IF NOT EXISTS web_thread_seq (
  platform_id  TEXT NOT NULL,
  thread_id    TEXT NOT NULL,
  next_seq     INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (platform_id, thread_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_web_messages_thread_seq
  ON web_messages(platform_id, thread_id, thread_seq)
  WHERE thread_seq IS NOT NULL;
`;

export interface WebchatThreadMeta {
  id: string;
  title: string;
}

export interface WebchatAttachmentInput {
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size?: number;
  data?: string;
  url?: string;
}

export interface WebchatStoredMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  timestamp: number;
  platformId: string;
  threadId: string;
  threadSeq?: number;
  senderName?: string;
  attachments?: WebchatAttachmentInput[];
}

interface StoredAttachmentMeta {
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size: number;
  storageName: string;
}

export function webchatDbPath(): string {
  return path.join(DATA_DIR, 'webchat.db');
}

export function webchatFilesDir(): string {
  return path.join(DATA_DIR, 'webchat', 'files');
}

function sanitizeMessageId(messageId: string): string | null {
  if (messageId.includes('/') || messageId.includes('\\')) return null;
  const base = path.basename(messageId);
  if (!base || base === '.' || base === '..') return null;
  if (base !== messageId) return null;
  return base;
}

function messageFilesDir(messageId: string): string {
  const safeId = sanitizeMessageId(messageId);
  if (!safeId) throw new Error(`Invalid message id: ${messageId}`);
  return path.join(webchatFilesDir(), safeId);
}

function openDb(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(webchatDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function ensureWebchatSchema(): void {
  fs.mkdirSync(webchatFilesDir(), { recursive: true });
  const db = openDb();
  try {
    db.exec(WEBCHAT_SCHEMA);
    try {
      db.exec('ALTER TABLE web_messages ADD COLUMN thread_seq INTEGER');
    } catch {
      // column already exists
    }
    db.exec(WEBCHAT_THREAD_SEQ_SCHEMA);
    backfillThreadSeqForExistingMessages(db);
  } finally {
    db.close();
  }
}

export function backfillThreadSeqForExistingMessages(db: Database.Database): void {
  const threads = db
    .prepare(`SELECT DISTINCT platform_id, thread_id FROM web_messages WHERE thread_seq IS NULL`)
    .all() as Array<{ platform_id: string; thread_id: string }>;
  for (const { platform_id, thread_id } of threads) {
    const rows = db
      .prepare(
        `SELECT id FROM web_messages
         WHERE platform_id = ? AND thread_id = ? AND thread_seq IS NULL
         ORDER BY timestamp_ms ASC, id ASC`,
      )
      .all(platform_id, thread_id) as Array<{ id: string }>;
    if (rows.length === 0) continue;
    let seq =
      (
        db
          .prepare(
            `SELECT COALESCE(MAX(thread_seq), 0) AS max_seq FROM web_messages
             WHERE platform_id = ? AND thread_id = ?`,
          )
          .get(platform_id, thread_id) as { max_seq: number }
      ).max_seq + 1;
    const update = db.prepare(`UPDATE web_messages SET thread_seq = ? WHERE id = ?`);
    for (const row of rows) {
      update.run(seq, row.id);
      seq += 1;
    }
    db.prepare(
      `INSERT INTO web_thread_seq (platform_id, thread_id, next_seq)
       VALUES (?, ?, ?)
       ON CONFLICT(platform_id, thread_id) DO UPDATE SET next_seq = excluded.next_seq`,
    ).run(platform_id, thread_id, seq - 1);
  }
}

function allocateThreadSeq(db: Database.Database, platformId: string, threadId: string): number {
  db.prepare(
    `INSERT INTO web_thread_seq (platform_id, thread_id, next_seq)
     VALUES (?, ?, 1)
     ON CONFLICT(platform_id, thread_id) DO UPDATE SET next_seq = next_seq + 1`,
  ).run(platformId, threadId);
  const row = db
    .prepare(`SELECT next_seq FROM web_thread_seq WHERE platform_id = ? AND thread_id = ?`)
    .get(platformId, threadId) as { next_seq: number };
  return row.next_seq;
}

export function newThreadId(): string {
  return `thread_${crypto.randomUUID()}`;
}

export function listThreads(platformId: string): WebchatThreadMeta[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT thread_id AS id, title FROM web_threads WHERE platform_id = ?
         ORDER BY CASE WHEN thread_id = ? THEN 0 ELSE 1 END, created_at ASC`,
      )
      .all(platformId, MAIN_THREAD) as WebchatThreadMeta[];
    if (rows.some((r) => r.id === MAIN_THREAD)) return rows;
    return [{ id: MAIN_THREAD, title: 'Main' }, ...rows];
  } finally {
    db.close();
  }
}

export function upsertThread(platformId: string, threadId: string, title: string): void {
  const now = new Date().toISOString();
  const db = openDb();
  try {
    db.prepare(
      `INSERT INTO web_threads (platform_id, thread_id, title, created_at, updated_at)
       VALUES (@platform_id, @thread_id, @title, @created_at, @updated_at)
       ON CONFLICT(platform_id, thread_id) DO UPDATE SET
         title = excluded.title,
         updated_at = excluded.updated_at`,
    ).run({
      platform_id: platformId,
      thread_id: threadId,
      title,
      created_at: now,
      updated_at: now,
    });
  } finally {
    db.close();
  }
}

export function createThread(platformId: string, title: string): WebchatThreadMeta {
  const threadId = newThreadId();
  upsertThread(platformId, threadId, title);
  return { id: threadId, title };
}

function sanitizeStorageName(name: string, index: number): string {
  const base = path.basename(name).replace(/[^\w.\-()+@]/g, '_');
  const trimmed = base.length > 0 ? base : `file-${index}`;
  return `${index}-${trimmed}`;
}

function writeAttachmentFiles(messageId: string, attachments: WebchatAttachmentInput[]): StoredAttachmentMeta[] {
  if (attachments.length === 0) return [];
  const dir = messageFilesDir(messageId);
  fs.mkdirSync(dir, { recursive: true });
  const stored: StoredAttachmentMeta[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]!;
    const data = att.data ?? '';
    if (!data) continue;
    const storageName = sanitizeStorageName(att.name, i);
    const filePath = path.join(dir, storageName);
    const decoded = Buffer.from(data, 'base64');
    fs.writeFileSync(filePath, decoded);
    stored.push({
      name: att.name,
      mimeType: att.mimeType,
      type: att.type,
      size: att.size ?? decoded.length,
      storageName,
    });
  }
  return stored;
}

function deleteMessageFiles(messageId: string): void {
  const dir = messageFilesDir(messageId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function attachmentApiPath(messageId: string, storageName: string): string {
  return `/api/attachments/${encodeURIComponent(messageId)}/${encodeURIComponent(storageName)}`;
}

function storedToApiAttachments(messageId: string, stored: StoredAttachmentMeta[]): WebchatAttachmentInput[] {
  return stored.map((att) => ({
    name: att.name,
    mimeType: att.mimeType,
    type: att.type,
    size: att.size,
    url: attachmentApiPath(messageId, att.storageName),
  }));
}

function parseStoredAttachments(raw: string | null): StoredAttachmentMeta[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as StoredAttachmentMeta[];
  } catch {
    return [];
  }
}

export function appendMessage(msg: WebchatStoredMessage): WebchatStoredMessage {
  const storedAttachments = writeAttachmentFiles(msg.id, msg.attachments ?? []);
  const attachmentsJson = storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null;

  let threadSeq = 0;
  const db = openDb();
  try {
    threadSeq = allocateThreadSeq(db, msg.platformId, msg.threadId);
    db.prepare(
      `INSERT INTO web_messages
         (id, platform_id, thread_id, thread_seq, direction, text, timestamp_ms, sender_name, attachments_json)
       VALUES (@id, @platform_id, @thread_id, @thread_seq, @direction, @text, @timestamp_ms, @sender_name, @attachments_json)`,
    ).run({
      id: msg.id,
      platform_id: msg.platformId,
      thread_id: msg.threadId,
      thread_seq: threadSeq,
      direction: msg.direction,
      text: msg.text,
      timestamp_ms: msg.timestamp,
      sender_name: msg.senderName ?? null,
      attachments_json: attachmentsJson,
    });
  } finally {
    db.close();
  }

  const apiAttachments = storedAttachments.length > 0 ? storedToApiAttachments(msg.id, storedAttachments) : undefined;

  return {
    ...msg,
    threadSeq,
    ...(apiAttachments ? { attachments: apiAttachments } : {}),
  };
}

export function getMessages(platformId: string, threadId: string, sinceMs = 0): WebchatStoredMessage[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, direction, text, timestamp_ms, sender_name, attachments_json, thread_seq
         FROM web_messages
         WHERE platform_id = ? AND thread_id = ? AND timestamp_ms > ?
         ORDER BY timestamp_ms ASC`,
      )
      .all(platformId, threadId, sinceMs) as Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      text: string;
      timestamp_ms: number;
      sender_name: string | null;
      attachments_json: string | null;
      thread_seq: number | null;
    }>;

    return rows.map((row) => {
      const stored = parseStoredAttachments(row.attachments_json);
      const attachments = stored.length > 0 ? storedToApiAttachments(row.id, stored) : undefined;
      return {
        id: row.id,
        direction: row.direction,
        text: row.text,
        timestamp: row.timestamp_ms,
        platformId,
        threadId,
        ...(row.thread_seq != null ? { threadSeq: row.thread_seq } : {}),
        ...(row.sender_name ? { senderName: row.sender_name } : {}),
        ...(attachments ? { attachments } : {}),
      };
    });
  } finally {
    db.close();
  }
}

export function getMessageAttachmentPath(messageId: string, storageName: string): string | null {
  const safeId = sanitizeMessageId(messageId);
  if (!safeId) return null;
  if (storageName.includes('/') || storageName.includes('\\')) return null;
  const safeName = path.basename(storageName);
  if (!safeName || safeName === '.' || safeName === '..') return null;
  const root = path.join(webchatFilesDir(), safeId);
  const filePath = path.join(root, safeName);
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep)) return null;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return null;
  return filePath;
}

export function getEngagedAgents(platformId: string, threadId: string): string[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT agent_folder FROM web_thread_engaged
         WHERE platform_id = ? AND thread_id = ?
         ORDER BY engaged_at ASC`,
      )
      .all(platformId, threadId) as Array<{ agent_folder: string }>;
    return rows.map((r) => r.agent_folder);
  } finally {
    db.close();
  }
}

export function addEngagedAgents(platformId: string, threadId: string, folders: readonly string[]): string[] {
  if (folders.length === 0) return getEngagedAgents(platformId, threadId);

  const now = Date.now();
  const db = openDb();
  try {
    const insert = db.prepare(
      `INSERT INTO web_thread_engaged (platform_id, thread_id, agent_folder, engaged_at)
       VALUES (@platform_id, @thread_id, @agent_folder, @engaged_at)
       ON CONFLICT(platform_id, thread_id, agent_folder) DO NOTHING`,
    );
    for (const folder of folders) {
      insert.run({
        platform_id: platformId,
        thread_id: threadId,
        agent_folder: folder,
        engaged_at: now,
      });
    }
  } finally {
    db.close();
  }
  return getEngagedAgents(platformId, threadId);
}

export function removeEngagedAgent(platformId: string, threadId: string, folder: string): string[] {
  const db = openDb();
  try {
    db.prepare(
      `DELETE FROM web_thread_engaged
       WHERE platform_id = ? AND thread_id = ? AND agent_folder = ?`,
    ).run(platformId, threadId, folder);
    db.prepare(
      `DELETE FROM web_thread_backfill_delivered
       WHERE platform_id = ? AND thread_id = ? AND agent_folder = ?`,
    ).run(platformId, threadId, folder);
  } finally {
    db.close();
  }
  return getEngagedAgents(platformId, threadId);
}

export function hasBackfillDelivered(platformId: string, threadId: string, folder: string): boolean {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `SELECT 1 FROM web_thread_backfill_delivered
         WHERE platform_id = ? AND thread_id = ? AND agent_folder = ?`,
      )
      .get(platformId, threadId, folder);
    return row != null;
  } finally {
    db.close();
  }
}

export function markBackfillDelivered(platformId: string, threadId: string, folder: string): void {
  const db = openDb();
  try {
    db.prepare(
      `INSERT INTO web_thread_backfill_delivered (platform_id, thread_id, agent_folder, delivered_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(platform_id, thread_id, agent_folder) DO UPDATE SET delivered_at = excluded.delivered_at`,
    ).run(platformId, threadId, folder, Date.now());
  } finally {
    db.close();
  }
}

function loadAttachmentDataFromDisk(messageId: string, stored: StoredAttachmentMeta[]): WebchatAttachmentInput[] {
  return stored.map((att) => {
    const filePath = getMessageAttachmentPath(messageId, att.storageName);
    let data: string | undefined;
    if (filePath) {
      try {
        data = fs.readFileSync(filePath).toString('base64');
      } catch {
        data = undefined;
      }
    }
    return {
      name: att.name,
      mimeType: att.mimeType,
      type: att.type,
      size: att.size,
      ...(data ? { data } : { url: attachmentApiPath(messageId, att.storageName) }),
    };
  });
}

export function enrichMessagesWithAttachmentData(messages: WebchatStoredMessage[]): WebchatStoredMessage[] {
  return messages.map((msg) => {
    if (!msg.attachments?.length) return msg;
    const db = openDb();
    let stored: StoredAttachmentMeta[] = [];
    try {
      const row = db.prepare('SELECT attachments_json FROM web_messages WHERE id = ?').get(msg.id) as
        | { attachments_json: string | null }
        | undefined;
      stored = parseStoredAttachments(row?.attachments_json ?? null);
    } finally {
      db.close();
    }
    if (stored.length === 0) return msg;
    return { ...msg, attachments: loadAttachmentDataFromDisk(msg.id, stored) };
  });
}

export function getRecentMessages(platformId: string, threadId: string, limit: number): WebchatStoredMessage[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, direction, text, timestamp_ms, sender_name, attachments_json, thread_seq
         FROM web_messages
         WHERE platform_id = ? AND thread_id = ?
         ORDER BY timestamp_ms DESC
         LIMIT ?`,
      )
      .all(platformId, threadId, limit) as Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      text: string;
      timestamp_ms: number;
      sender_name: string | null;
      attachments_json: string | null;
      thread_seq: number | null;
    }>;

    return rows.reverse().map((row) => {
      const stored = parseStoredAttachments(row.attachments_json);
      const attachments = stored.length > 0 ? storedToApiAttachments(row.id, stored) : undefined;
      return {
        id: row.id,
        direction: row.direction,
        text: row.text,
        timestamp: row.timestamp_ms,
        platformId,
        threadId,
        ...(row.thread_seq != null ? { threadSeq: row.thread_seq } : {}),
        ...(row.sender_name ? { senderName: row.sender_name } : {}),
        ...(attachments ? { attachments } : {}),
      };
    });
  } finally {
    db.close();
  }
}

export function deleteThreadData(platformId: string, threadId: string): string[] {
  const db = openDb();
  const messageIds: string[] = [];
  try {
    db.transaction(() => {
      const rows = db
        .prepare('SELECT id FROM web_messages WHERE platform_id = ? AND thread_id = ?')
        .all(platformId, threadId) as Array<{ id: string }>;
      messageIds.push(...rows.map((r) => r.id));

      db.prepare('DELETE FROM web_messages WHERE platform_id = ? AND thread_id = ?').run(platformId, threadId);
      db.prepare('DELETE FROM web_thread_engaged WHERE platform_id = ? AND thread_id = ?').run(platformId, threadId);
      db.prepare('DELETE FROM web_thread_backfill_delivered WHERE platform_id = ? AND thread_id = ?').run(
        platformId,
        threadId,
      );
      db.prepare('DELETE FROM web_threads WHERE platform_id = ? AND thread_id = ?').run(platformId, threadId);
    })();
  } finally {
    db.close();
  }

  for (const id of messageIds) {
    deleteMessageFiles(id);
  }
  return messageIds;
}

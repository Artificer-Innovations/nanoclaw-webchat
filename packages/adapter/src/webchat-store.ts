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

export interface WebchatCardOption {
  label: string;
  selectedLabel?: string;
  value: string;
}

export interface WebchatAskQuestionCard {
  type: 'ask_question';
  questionId: string;
  title: string;
  question: string;
  options: WebchatCardOption[];
  status: 'pending' | 'answered';
  selectedValue?: string;
  selectedLabel?: string;
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
  senderId?: string;
  attachments?: WebchatAttachmentInput[];
  card?: WebchatAskQuestionCard;
}

interface StoredAttachmentMeta {
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size: number;
  storageName: string;
}

export type { StoredAttachmentMeta };

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
    try {
      db.exec('ALTER TABLE web_messages ADD COLUMN card_json TEXT');
    } catch {
      // column already exists
    }
    try {
      db.exec('ALTER TABLE web_messages ADD COLUMN sender_id TEXT');
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

function assertRegularFile(filePath: string): void {
  const st = fs.lstatSync(filePath);
  if (!st.isFile()) throw new Error('not a file');
}

export interface AttachmentFileSource {
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size: number;
  sourcePath: string;
}

export function moveAttachmentIntoMessage(
  messageId: string,
  index: number,
  source: AttachmentFileSource,
): StoredAttachmentMeta {
  const dir = messageFilesDir(messageId);
  fs.mkdirSync(dir, { recursive: true });
  assertRegularFile(source.sourcePath);
  const storageName = sanitizeStorageName(source.name, index);
  const destPath = path.join(dir, storageName);
  try {
    fs.renameSync(source.sourcePath, destPath);
  } catch {
    fs.copyFileSync(source.sourcePath, destPath);
    fs.unlinkSync(source.sourcePath);
  }
  return {
    name: source.name,
    mimeType: source.mimeType,
    type: source.type,
    size: source.size,
    storageName,
  };
}

export function appendMessageWithAttachmentMeta(
  msg: WebchatStoredMessage,
  storedAttachments: StoredAttachmentMeta[],
): WebchatStoredMessage {
  const attachmentsJson = storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null;
  const cardJson = msg.card ? JSON.stringify(msg.card) : null;

  let threadSeq = 0;
  const db = openDb();
  try {
    threadSeq = allocateThreadSeq(db, msg.platformId, msg.threadId);
    db.prepare(
      `INSERT INTO web_messages
         (id, platform_id, thread_id, thread_seq, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, card_json)
       VALUES (@id, @platform_id, @thread_id, @thread_seq, @direction, @text, @timestamp_ms, @sender_name, @sender_id, @attachments_json, @card_json)`,
    ).run({
      id: msg.id,
      platform_id: msg.platformId,
      thread_id: msg.threadId,
      thread_seq: threadSeq,
      direction: msg.direction,
      text: msg.text,
      timestamp_ms: msg.timestamp,
      sender_name: msg.senderName ?? null,
      sender_id: msg.senderId ?? null,
      attachments_json: attachmentsJson,
      card_json: cardJson,
    });
  } finally {
    db.close();
  }

  const apiAttachments =
    storedAttachments.length > 0 ? storedToApiAttachments(msg.id, storedAttachments) : undefined;

  return {
    ...msg,
    threadSeq,
    ...(apiAttachments ? { attachments: apiAttachments } : {}),
  };
}

export function writeAttachmentFiles(
  messageId: string,
  attachments: WebchatAttachmentInput[],
  startIndex = 0,
): StoredAttachmentMeta[] {
  if (attachments.length === 0) return [];
  const dir = messageFilesDir(messageId);
  fs.mkdirSync(dir, { recursive: true });
  const stored: StoredAttachmentMeta[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]!;
    const data = att.data ?? '';
    if (!data) continue;
    const storageName = sanitizeStorageName(att.name, startIndex + i);
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

export function deleteMessageFiles(messageId: string): void {
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

function parseStoredCard(raw: string | null): WebchatAskQuestionCard | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as WebchatAskQuestionCard;
    if (parsed.type !== 'ask_question') return undefined;
    if (typeof parsed.questionId !== 'string') return undefined;
    return {
      ...parsed,
      status: parsed.status ?? 'pending',
    };
  } catch {
    return undefined;
  }
}

function rowToMessage(
  row: {
    id: string;
    direction: 'inbound' | 'outbound';
    text: string;
    timestamp_ms: number;
    sender_name: string | null;
    sender_id?: string | null;
    attachments_json: string | null;
    thread_seq: number | null;
    card_json?: string | null;
  },
  platformId: string,
  threadId: string,
): WebchatStoredMessage {
  const stored = parseStoredAttachments(row.attachments_json);
  const attachments = stored.length > 0 ? storedToApiAttachments(row.id, stored) : undefined;
  const card = parseStoredCard(row.card_json ?? null);
  return {
    id: row.id,
    direction: row.direction,
    text: row.text,
    timestamp: row.timestamp_ms,
    platformId,
    threadId,
    ...(row.thread_seq != null ? { threadSeq: row.thread_seq } : {}),
    ...(row.sender_name ? { senderName: row.sender_name } : {}),
    ...(row.sender_id ? { senderId: row.sender_id } : {}),
    ...(attachments ? { attachments } : {}),
    ...(card ? { card } : {}),
  };
}

export function appendMessage(msg: WebchatStoredMessage): WebchatStoredMessage {
  const storedAttachments = writeAttachmentFiles(msg.id, msg.attachments ?? []);
  const attachmentsJson = storedAttachments.length > 0 ? JSON.stringify(storedAttachments) : null;
  const cardJson = msg.card ? JSON.stringify(msg.card) : null;

  let threadSeq = 0;
  const db = openDb();
  try {
    threadSeq = allocateThreadSeq(db, msg.platformId, msg.threadId);
    db.prepare(
      `INSERT INTO web_messages
         (id, platform_id, thread_id, thread_seq, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, card_json)
       VALUES (@id, @platform_id, @thread_id, @thread_seq, @direction, @text, @timestamp_ms, @sender_name, @sender_id, @attachments_json, @card_json)`,
    ).run({
      id: msg.id,
      platform_id: msg.platformId,
      thread_id: msg.threadId,
      thread_seq: threadSeq,
      direction: msg.direction,
      text: msg.text,
      timestamp_ms: msg.timestamp,
      sender_name: msg.senderName ?? null,
      sender_id: msg.senderId ?? null,
      attachments_json: attachmentsJson,
      card_json: cardJson,
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
        `SELECT id, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, thread_seq, card_json
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
      sender_id?: string | null;
      attachments_json: string | null;
      thread_seq: number | null;
      card_json: string | null;
    }>;

    return rows.map((row) => rowToMessage(row, platformId, threadId));
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
         ORDER BY engaged_at ASC, agent_folder ASC`,
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
        `SELECT id, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, thread_seq, card_json
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
      sender_id?: string | null;
      attachments_json: string | null;
      thread_seq: number | null;
      card_json: string | null;
    }>;

    return rows.reverse().map((row) => rowToMessage(row, platformId, threadId));
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

export function findMessagesByQuestionId(questionId: string): WebchatStoredMessage[] {
  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, thread_seq, card_json,
                platform_id, thread_id
         FROM web_messages
         WHERE card_json IS NOT NULL
           AND json_valid(card_json)
           AND json_extract(card_json, '$.questionId') = ?
         ORDER BY timestamp_ms DESC`,
      )
      .all(questionId) as Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      text: string;
      timestamp_ms: number;
      sender_name: string | null;
      sender_id?: string | null;
      attachments_json: string | null;
      thread_seq: number | null;
      card_json: string | null;
      platform_id: string;
      thread_id: string;
    }>;

    const matches: WebchatStoredMessage[] = [];
    for (const row of rows) {
      const card = parseStoredCard(row.card_json);
      if (card?.questionId === questionId) {
        matches.push(rowToMessage(row, row.platform_id, row.thread_id));
      }
    }
    return matches;
  } finally {
    db.close();
  }
}

export type AnswerCardsResult =
  | { ok: true; messages: WebchatStoredMessage[] }
  | { ok: false; reason: 'already_answered' | 'not_found' };

export function answerCardsByQuestionId(
  questionId: string,
  selectedValue: string,
  selectedLabel: string,
): AnswerCardsResult {
  const db = openDb();
  try {
    const patch = JSON.stringify({ status: 'answered', selectedValue, selectedLabel });
    const result = db
      .prepare(
        `UPDATE web_messages
         SET card_json = json_patch(card_json, json(?))
         WHERE card_json IS NOT NULL
           AND json_valid(card_json)
           AND json_extract(card_json, '$.questionId') = ?
           AND (json_extract(card_json, '$.status') IS NULL OR json_extract(card_json, '$.status') = 'pending')`,
      )
      .run(patch, questionId);

    if (result.changes === 0) {
      const answered = db
        .prepare(
          `SELECT 1 AS ok FROM web_messages
           WHERE card_json IS NOT NULL
             AND json_valid(card_json)
             AND json_extract(card_json, '$.questionId') = ?
             AND json_extract(card_json, '$.status') = 'answered'
           LIMIT 1`,
        )
        .get(questionId) as { ok: number } | undefined;
      if (answered) return { ok: false, reason: 'already_answered' };
      return { ok: false, reason: 'not_found' };
    }

    const rows = db
      .prepare(
        `SELECT id, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, thread_seq, card_json,
                platform_id, thread_id
         FROM web_messages
         WHERE card_json IS NOT NULL
           AND json_valid(card_json)
           AND json_extract(card_json, '$.questionId') = ?
         ORDER BY timestamp_ms DESC`,
      )
      .all(questionId) as Array<{
      id: string;
      direction: 'inbound' | 'outbound';
      text: string;
      timestamp_ms: number;
      sender_name: string | null;
      sender_id?: string | null;
      attachments_json: string | null;
      thread_seq: number | null;
      card_json: string | null;
      platform_id: string;
      thread_id: string;
    }>;

    const messages = rows
      .map((row) => {
        const card = parseStoredCard(row.card_json);
        if (card?.questionId !== questionId) return undefined;
        return rowToMessage(row, row.platform_id, row.thread_id);
      })
      .filter((message): message is WebchatStoredMessage => message !== undefined);

    return { ok: true, messages };
  } finally {
    db.close();
  }
}

/** Revert all answered copies of a question back to pending (e.g. after onAction failure). */
export function revertCardsByQuestionId(questionId: string): void {
  const db = openDb();
  try {
    const patch = JSON.stringify({ status: 'pending' });
    db.prepare(
      `UPDATE web_messages
       SET card_json = json_patch(
         json_remove(json_remove(card_json, '$.selectedValue'), '$.selectedLabel'),
         json(?)
       )
       WHERE card_json IS NOT NULL
         AND json_valid(card_json)
         AND json_extract(card_json, '$.questionId') = ?
         AND json_extract(card_json, '$.status') = 'answered'`,
    ).run(patch, questionId);
  } finally {
    db.close();
  }
}

export function findMessageByQuestionId(
  platformId: string,
  threadId: string,
  questionId: string,
): WebchatStoredMessage | undefined {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `SELECT id, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, thread_seq, card_json
         FROM web_messages
         WHERE platform_id = ? AND thread_id = ?
           AND json_valid(card_json)
           AND json_extract(card_json, '$.questionId') = ?
         ORDER BY timestamp_ms DESC
         LIMIT 1`,
      )
      .get(platformId, threadId, questionId) as
      | {
          id: string;
          direction: 'inbound' | 'outbound';
          text: string;
          timestamp_ms: number;
          sender_name: string | null;
          sender_id?: string | null;
          attachments_json: string | null;
          thread_seq: number | null;
          card_json: string | null;
        }
      | undefined;

    if (!row) return undefined;
    const card = parseStoredCard(row.card_json);
    if (card?.questionId !== questionId) return undefined;
    return rowToMessage(row, platformId, threadId);
  } finally {
    db.close();
  }
}

export function updateMessageCard(messageId: string, card: WebchatAskQuestionCard): WebchatStoredMessage | undefined {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `SELECT id, direction, text, timestamp_ms, sender_name, sender_id, attachments_json, thread_seq, card_json,
                platform_id, thread_id
         FROM web_messages WHERE id = ?`,
      )
      .get(messageId) as
      | {
          id: string;
          direction: 'inbound' | 'outbound';
          text: string;
          timestamp_ms: number;
          sender_name: string | null;
          sender_id?: string | null;
          attachments_json: string | null;
          thread_seq: number | null;
          card_json: string | null;
          platform_id: string;
          thread_id: string;
        }
      | undefined;
    if (!row) return undefined;

    db.prepare('UPDATE web_messages SET card_json = ? WHERE id = ?').run(JSON.stringify(card), messageId);

    return rowToMessage({ ...row, card_json: JSON.stringify(card) }, row.platform_id, row.thread_id);
  } finally {
    db.close();
  }
}

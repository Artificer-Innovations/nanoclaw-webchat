import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', async () => {
  const actual = await vi.importActual<typeof import('./config.js')>('./config.js');
  return { ...actual, DATA_DIR: '/tmp/nanoclaw-webchat-store-test' };
});

const TEST_DATA = '/tmp/nanoclaw-webchat-store-test';

import {
  addEngagedAgents,
  appendMessage,
  backfillThreadSeqForExistingMessages,
  createThread,
  deleteThreadData,
  ensureWebchatSchema,
  enrichMessagesWithAttachmentData,
  getEngagedAgents,
  getMessageAttachmentPath,
  findMessageByQuestionId,
  findMessagesByQuestionId,
  getMessages,
  getRecentMessages,
  hasBackfillDelivered,
  listThreads,
  MAIN_THREAD,
  markBackfillDelivered,
  removeEngagedAgent,
  updateMessageCard,
  upsertThread,
  webchatDbPath,
  webchatFilesDir,
} from './webchat-store.js';

function resetStore(): void {
  if (fs.existsSync(TEST_DATA)) {
    fs.rmSync(TEST_DATA, { recursive: true, force: true });
  }
  ensureWebchatSchema();
}

describe('webchat-store', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DATA)) {
      fs.rmSync(TEST_DATA, { recursive: true, force: true });
    }
  });

  it('creates schema and lists main thread by default', () => {
    expect(fs.existsSync(webchatDbPath())).toBe(true);
    const threads = listThreads('lobby');
    expect(threads).toEqual([{ id: MAIN_THREAD, title: 'Main' }]);
  });

  it('persists messages across store reopen', () => {
    appendMessage({
      id: 'web-1',
      direction: 'inbound',
      text: 'hello',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    const msgs = getMessages('lobby', MAIN_THREAD);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe('hello');
  });

  it('stores attachment files and returns url on read', () => {
    const data = Buffer.from('png-bytes').toString('base64');
    appendMessage({
      id: 'web-att',
      direction: 'inbound',
      text: 'pic',
      timestamp: 2000,
      platformId: 'lobby',
      threadId: 'thread_1',
      attachments: [
        {
          name: 'photo.png',
          mimeType: 'image/png',
          type: 'image',
          size: 8,
          data,
        },
      ],
    });
    const msgs = getMessages('lobby', 'thread_1');
    expect(msgs[0]!.attachments?.[0]?.url).toBe('/api/attachments/web-att/0-photo.png');
    const filePath = getMessageAttachmentPath('web-att', '0-photo.png');
    expect(filePath).toBeTruthy();
    expect(fs.readFileSync(filePath!)).toEqual(Buffer.from('png-bytes'));
  });

  it('rejects path traversal in attachment lookup', () => {
    expect(getMessageAttachmentPath('..', '0-photo.png')).toBeNull();
    expect(getMessageAttachmentPath('../secrets', '0-photo.png')).toBeNull();
    expect(getMessageAttachmentPath('web-att/../../etc/passwd', '0-photo.png')).toBeNull();
  });

  it('orders main thread first when stored in web_threads', () => {
    createThread('lobby', 'Topic');
    upsertThread('lobby', MAIN_THREAD, 'Renamed Main');
    const listed = listThreads('lobby');
    expect(listed[0]).toEqual({ id: MAIN_THREAD, title: 'Renamed Main' });
  });

  it('tracks engaged agents per thread and clears them on delete', () => {
    expect(getEngagedAgents('lobby', MAIN_THREAD)).toEqual([]);
    expect(addEngagedAgents('lobby', MAIN_THREAD, ['sarah'])).toEqual(['sarah']);
    expect(addEngagedAgents('lobby', MAIN_THREAD, ['diego'])).toEqual(['sarah', 'diego']);
    expect(addEngagedAgents('lobby', MAIN_THREAD, ['sarah'])).toEqual(['sarah', 'diego']);

    const thread = createThread('lobby', 'Topic');
    addEngagedAgents('lobby', thread.id, ['sarah']);
    expect(getEngagedAgents('lobby', thread.id)).toEqual(['sarah']);

    deleteThreadData('lobby', thread.id);
    expect(getEngagedAgents('lobby', thread.id)).toEqual([]);
  });

  it('removes one engaged agent without clearing others', () => {
    addEngagedAgents('lobby', MAIN_THREAD, ['sarah', 'diego']);
    expect(removeEngagedAgent('lobby', MAIN_THREAD, 'sarah')).toEqual(['diego']);
    expect(getEngagedAgents('lobby', MAIN_THREAD)).toEqual(['diego']);
  });

  it('returns recent messages in chronological order', () => {
    for (let i = 1; i <= 3; i++) {
      appendMessage({
        id: `web-${i}`,
        direction: 'inbound',
        text: `msg-${i}`,
        timestamp: i * 1000,
        platformId: 'lobby',
        threadId: MAIN_THREAD,
      });
    }
    expect(getRecentMessages('lobby', MAIN_THREAD, 2).map((m) => m.text)).toEqual(['msg-2', 'msg-3']);
  });

  it('tracks backfill delivery per engaged agent', () => {
    expect(hasBackfillDelivered('lobby', MAIN_THREAD, 'sarah')).toBe(false);
    markBackfillDelivered('lobby', MAIN_THREAD, 'sarah');
    expect(hasBackfillDelivered('lobby', MAIN_THREAD, 'sarah')).toBe(true);
    addEngagedAgents('lobby', MAIN_THREAD, ['sarah', 'diego']);
    expect(hasBackfillDelivered('lobby', MAIN_THREAD, 'diego')).toBe(false);
    removeEngagedAgent('lobby', MAIN_THREAD, 'sarah');
    expect(hasBackfillDelivered('lobby', MAIN_THREAD, 'sarah')).toBe(false);
  });

  it('assigns monotonic thread-scoped sequence numbers per thread', () => {
    const first = appendMessage({
      id: 'web-seq-1',
      direction: 'inbound',
      text: 'one',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    const second = appendMessage({
      id: 'web-seq-2',
      direction: 'outbound',
      text: 'two',
      timestamp: 2000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      senderName: 'Sarah',
    });
    expect(first.threadSeq).toBe(1);
    expect(second.threadSeq).toBe(2);
    expect(getRecentMessages('lobby', MAIN_THREAD, 10).map((m) => m.threadSeq)).toEqual([1, 2]);
  });

  it('backfills legacy thread_seq rows without skipping the next allocation', () => {
    ensureWebchatSchema();
    const db = new Database(webchatDbPath());
    try {
      const insert = db.prepare(
        `INSERT INTO web_messages
           (id, platform_id, thread_id, thread_seq, direction, text, timestamp_ms)
         VALUES (?, ?, ?, NULL, 'inbound', ?, ?)`,
      );
      insert.run('legacy-1', 'lobby', MAIN_THREAD, 'one', 100);
      insert.run('legacy-2', 'lobby', MAIN_THREAD, 'two', 200);
      insert.run('legacy-3', 'lobby', MAIN_THREAD, 'three', 300);
      backfillThreadSeqForExistingMessages(db);
    } finally {
      db.close();
    }

    const next = appendMessage({
      id: 'web-seq-after-backfill',
      direction: 'inbound',
      text: 'four',
      timestamp: 400,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    expect(next.threadSeq).toBe(4);
    expect(getRecentMessages('lobby', MAIN_THREAD, 10).map((m) => m.threadSeq)).toEqual([1, 2, 3, 4]);
  });

  it('creates and deletes threads', () => {
    const thread = createThread('lobby', 'Topic');
    expect(thread.id.startsWith('thread_')).toBe(true);
    upsertThread('lobby', MAIN_THREAD, 'Main');
    const listed = listThreads('lobby');
    expect(listed.some((t) => t.id === thread.id)).toBe(true);

    appendMessage({
      id: 'web-del',
      direction: 'inbound',
      text: 'gone',
      timestamp: 3000,
      platformId: 'lobby',
      threadId: thread.id,
    });

    deleteThreadData('lobby', thread.id);
    expect(listThreads('lobby').some((t) => t.id === thread.id)).toBe(false);
    expect(getMessages('lobby', thread.id)).toHaveLength(0);
    expect(fs.existsSync(path.join(TEST_DATA, 'webchat', 'files', 'web-del'))).toBe(false);
  });

  it('exposes webchat files directory under DATA_DIR', () => {
    ensureWebchatSchema();
    expect(webchatFilesDir()).toBe(path.join(TEST_DATA, 'webchat', 'files'));
  });

  it('calls ensureWebchatSchema twice without error', () => {
    ensureWebchatSchema();
    expect(() => ensureWebchatSchema()).not.toThrow();
  });

  it('filters getMessages by sinceMs', () => {
    appendMessage({
      id: 'web-old',
      direction: 'inbound',
      text: 'old',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    appendMessage({
      id: 'web-new',
      direction: 'inbound',
      text: 'new',
      timestamp: 5000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    expect(getMessages('lobby', MAIN_THREAD, 2000).map((m) => m.text)).toEqual(['new']);
  });

  it('returns early from addEngagedAgents when folders array is empty', () => {
    addEngagedAgents('lobby', MAIN_THREAD, ['sarah']);
    expect(addEngagedAgents('lobby', MAIN_THREAD, [])).toEqual(['sarah']);
  });

  it('skips attachment entries with empty data on appendMessage', () => {
    appendMessage({
      id: 'web-no-data',
      direction: 'inbound',
      text: 'files',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'empty.bin', mimeType: 'application/octet-stream', type: 'file', size: 0, data: '' }],
    });
    expect(getMessages('lobby', MAIN_THREAD)[0]!.attachments).toBeUndefined();
  });

  it('returns null for attachment lookup on bad storageName or missing file', () => {
    appendMessage({
      id: 'web-att-lookup',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', size: 4, data: Buffer.from('x').toString('base64') }],
    });
    expect(getMessageAttachmentPath('web-att-lookup', '../evil.png')).toBeNull();
    expect(getMessageAttachmentPath('web-att-lookup', 'missing.png')).toBeNull();
    const dirPath = path.join(webchatFilesDir(), 'web-att-lookup', 'subdir');
    fs.mkdirSync(dirPath, { recursive: true });
    expect(getMessageAttachmentPath('web-att-lookup', 'subdir')).toBeNull();
  });

  it('throws on appendMessage with invalid message id when writing attachments', () => {
    expect(() =>
      appendMessage({
        id: '../bad',
        direction: 'inbound',
        text: 'x',
        timestamp: 1,
        platformId: 'lobby',
        threadId: MAIN_THREAD,
        attachments: [{ name: 'a.png', mimeType: 'image/png', type: 'image', size: 1, data: Buffer.from('x').toString('base64') }],
      }),
    ).toThrow('Invalid message id');
  });

  it('parses corrupt attachments_json as empty attachments on read', () => {
    ensureWebchatSchema();
    const db = new Database(webchatDbPath());
    try {
      db.prepare(
        `INSERT INTO web_messages (id, platform_id, thread_id, thread_seq, direction, text, timestamp_ms, attachments_json)
         VALUES ('bad-json', 'lobby', 'main', 1, 'inbound', 'x', 1, '{not-json')`,
      ).run();
    } finally {
      db.close();
    }
    expect(getMessages('lobby', MAIN_THREAD)[0]!.attachments).toBeUndefined();
  });

  it('sanitizes attachment filenames with special characters', () => {
    appendMessage({
      id: 'web-sanitize',
      direction: 'inbound',
      text: 'doc',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [
        {
          name: '../../etc/passwd',
          mimeType: 'text/plain',
          type: 'file',
          size: 3,
          data: Buffer.from('abc').toString('base64'),
        },
      ],
    });
    const msgs = getMessages('lobby', MAIN_THREAD);
    expect(msgs[0]!.attachments?.[0]?.url).toContain('/api/attachments/web-sanitize/');
    expect(msgs[0]!.attachments?.[0]?.url).not.toContain('..');
  });

  it('uses fallback storage name when attachment name is empty', () => {
    appendMessage({
      id: 'web-empty-name',
      direction: 'inbound',
      text: 'doc',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [
        {
          name: '',
          mimeType: 'text/plain',
          type: 'file',
          size: 3,
          data: Buffer.from('abc').toString('base64'),
        },
      ],
    });
    const filePath = getMessageAttachmentPath('web-empty-name', '0-file-0');
    expect(filePath).toBeTruthy();
  });

  it('enrichMessagesWithAttachmentData embeds base64 from disk when file exists', () => {
    appendMessage({
      id: 'web-enrich',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', size: 4, data: Buffer.from('abcd').toString('base64') }],
    });
    const stored = getMessages('lobby', MAIN_THREAD);
    const enriched = enrichMessagesWithAttachmentData(stored);
    expect(enriched[0]!.attachments?.[0]?.data).toBe(Buffer.from('abcd').toString('base64'));
  });

  it('removes attachment files when deleting a thread with uploads', () => {
    appendMessage({
      id: 'web-att-del',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: 'thread_del',
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', size: 4, data: Buffer.from('abcd').toString('base64') }],
    });
    expect(fs.existsSync(path.join(webchatFilesDir(), 'web-att-del'))).toBe(true);
    deleteThreadData('lobby', 'thread_del');
    expect(fs.existsSync(path.join(webchatFilesDir(), 'web-att-del'))).toBe(false);
  });

  it('deleteMessageFiles is safe when attachment dir is missing', () => {
    appendMessage({
      id: 'web-no-files',
      direction: 'inbound',
      text: 'plain',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    deleteThreadData('lobby', MAIN_THREAD);
    expect(getMessages('lobby', MAIN_THREAD)).toHaveLength(0);
  });

  it('enrichMessagesWithAttachmentData falls back to url when disk read fails', () => {
    appendMessage({
      id: 'web-enrich-fail',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', size: 4, data: Buffer.from('abcd').toString('base64') }],
    });
    const readSpy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('read failed');
    });
    try {
      const stored = getMessages('lobby', MAIN_THREAD);
      const enriched = enrichMessagesWithAttachmentData(stored);
      expect(enriched[0]!.attachments?.[0]?.url).toContain('/api/attachments/web-enrich-fail/');
      expect(enriched[0]!.attachments?.[0]?.data).toBeUndefined();
    } finally {
      readSpy.mockRestore();
    }
  });

  it('enrichMessagesWithAttachmentData returns message unchanged when no stored attachments', () => {
    appendMessage({
      id: 'web-no-att-json',
      direction: 'inbound',
      text: 'plain',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    const db = new Database(webchatDbPath());
    try {
      db.prepare('UPDATE web_messages SET attachments_json = NULL WHERE id = ?').run('web-no-att-json');
    } finally {
      db.close();
    }
    const stored = getMessages('lobby', MAIN_THREAD);
    expect(enrichMessagesWithAttachmentData(stored)).toEqual(stored);
  });

  it('enrichMessagesWithAttachmentData returns message unchanged when row is missing', () => {
    const ghost = {
      id: 'ghost-message',
      direction: 'inbound' as const,
      text: 'ghost',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'x.png', mimeType: 'image/png', type: 'image' as const, url: '/api/x' }],
    };
    expect(enrichMessagesWithAttachmentData([ghost])).toEqual([ghost]);
  });

  it('getMessageAttachmentPath rejects unsafe ids and storage names', () => {
    expect(getMessageAttachmentPath('../evil', 'file.png')).toBeNull();
    expect(getMessageAttachmentPath('web-safe', '../evil.png')).toBeNull();
    expect(getMessageAttachmentPath('web-safe', 'missing.png')).toBeNull();
    expect(getMessageAttachmentPath('web-safe', '.')).toBeNull();
    expect(getMessageAttachmentPath('web-safe', '..')).toBeNull();
  });

  it('getMessages includes senderName and threadSeq when present', () => {
    appendMessage({
      id: 'web-meta',
      direction: 'outbound',
      text: 'from agent',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      senderName: 'Sarah',
    });
    const msg = getMessages('lobby', MAIN_THREAD).find((m) => m.id === 'web-meta');
    expect(msg).toMatchObject({ senderName: 'Sarah', threadSeq: 1 });
  });

  it('getRecentMessages includes attachment urls from stored metadata', () => {
    appendMessage({
      id: 'web-recent-att',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', size: 4, data: Buffer.from('abcd').toString('base64') }],
    });
    const recent = getRecentMessages('lobby', MAIN_THREAD, 10);
    expect(recent[0]!.attachments?.[0]?.url).toContain('/api/attachments/');
  });

  it('skips attachment files when inbound data is empty', () => {
    appendMessage({
      id: 'web-empty-att',
      direction: 'inbound',
      text: 'no file',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'empty.png', mimeType: 'image/png', type: 'image', size: 0, data: '' }],
    });
    expect(fs.readdirSync(path.join(webchatFilesDir(), 'web-empty-att'))).toHaveLength(0);
  });

  it('enrichMessagesWithAttachmentData uses url when stored path is unsafe', () => {
    appendMessage({
      id: 'web-unsafe-path',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', size: 4, data: Buffer.from('abcd').toString('base64') }],
    });
    const db = new Database(webchatDbPath());
    try {
      db.prepare('UPDATE web_messages SET attachments_json = ? WHERE id = ?').run(
        JSON.stringify([
          {
            name: 'photo.png',
            mimeType: 'image/png',
            type: 'image',
            size: 4,
            storageName: '../evil.png',
          },
        ]),
        'web-unsafe-path',
      );
    } finally {
      db.close();
    }
    const stored = getMessages('lobby', MAIN_THREAD).filter((m) => m.id === 'web-unsafe-path');
    const enriched = enrichMessagesWithAttachmentData(stored);
    expect(enriched[0]!.attachments?.[0]?.url).toContain('/api/attachments/web-unsafe-path/');
  });

  it('getMessages omits threadSeq when legacy rows have null seq', () => {
    appendMessage({
      id: 'web-get-null-seq',
      direction: 'inbound',
      text: 'legacy',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    const db = new Database(webchatDbPath());
    try {
      db.prepare('UPDATE web_messages SET thread_seq = NULL WHERE id = ?').run('web-get-null-seq');
    } finally {
      db.close();
    }
    const msg = getMessages('lobby', MAIN_THREAD).find((m) => m.id === 'web-get-null-seq');
    expect(msg?.threadSeq).toBeUndefined();
  });

  it('stores attachment size from decoded bytes when size is omitted', () => {
    appendMessage({
      id: 'web-no-size',
      direction: 'inbound',
      text: 'pic',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'photo.png', mimeType: 'image/png', type: 'image', data: Buffer.from('abcd').toString('base64') }],
    });
    const db = new Database(webchatDbPath());
    try {
      const row = db
        .prepare('SELECT attachments_json FROM web_messages WHERE id = ?')
        .get('web-no-size') as { attachments_json: string };
      const stored = JSON.parse(row.attachments_json) as Array<{ size: number }>;
      expect(stored[0]!.size).toBe(4);
    } finally {
      db.close();
    }
  });

  it('rejects message ids that are not plain basenames', () => {
    expect(getMessageAttachmentPath('nested/id', 'file.png')).toBeNull();
  });

  it('rejects message ids when basename normalization would change the id', () => {
    const basenameSpy = vi.spyOn(path, 'basename').mockReturnValueOnce('other-id');
    expect(getMessageAttachmentPath('plain-id', 'file.png')).toBeNull();
    basenameSpy.mockRestore();
  });

  it('skips writing files when attachment payload omits data', () => {
    appendMessage({
      id: 'web-no-data-field',
      direction: 'inbound',
      text: 'no payload',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'empty.png', mimeType: 'image/png', type: 'image' }],
    });
    expect(fs.readdirSync(path.join(webchatFilesDir(), 'web-no-data-field'))).toHaveLength(0);
  });

  it('getRecentMessages omits threadSeq when legacy rows have null seq', () => {
    appendMessage({
      id: 'web-legacy-seq',
      direction: 'inbound',
      text: 'legacy',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
    });
    const db = new Database(webchatDbPath());
    try {
      db.prepare('UPDATE web_messages SET thread_seq = NULL WHERE id = ?').run('web-legacy-seq');
    } finally {
      db.close();
    }
    const recent = getRecentMessages('lobby', MAIN_THREAD, 10).find((m) => m.id === 'web-legacy-seq');
    expect(recent?.threadSeq).toBeUndefined();
  });

  it('backfillThreadSeqForExistingMessages skips threads with no null-seq rows', () => {
    const run = vi.fn();
    const db = {
      prepare: vi.fn((sql: string) => ({
        all: (...args: unknown[]) => {
          if (sql.includes('DISTINCT')) return [{ platform_id: 'lobby', thread_id: MAIN_THREAD }];
          if (sql.includes('thread_seq IS NULL') && sql.includes('ORDER BY')) return [];
          return [];
        },
        get: () => ({ max_seq: 0 }),
        run,
      })),
    };
    backfillThreadSeqForExistingMessages(db as unknown as Database.Database);
    expect(run).not.toHaveBeenCalled();
  });

  it('getMessageAttachmentPath rejects resolved paths outside the message directory', () => {
    appendMessage({
      id: 'web-path-escape',
      direction: 'inbound',
      text: 'file',
      timestamp: 1000,
      platformId: 'lobby',
      threadId: MAIN_THREAD,
      attachments: [{ name: 'escape.png', mimeType: 'image/png', type: 'image', data: Buffer.from('x').toString('base64') }],
    });
    const origResolve = path.resolve;
    const resolveSpy = vi.spyOn(path, 'resolve').mockImplementation((...args) => {
      const resolved = origResolve(...args);
      if (String(args[0]).includes('escape.png')) return '/outside/escape.png';
      return resolved;
    });
    try {
      expect(getMessageAttachmentPath('web-path-escape', '0-escape.png')).toBeNull();
    } finally {
      resolveSpy.mockRestore();
    }
  });

  it('round-trips interactive card_json on messages', () => {
    appendMessage({
      id: 'web-card',
      direction: 'outbound',
      text: 'Install MCP server\nAdd memory server?',
      timestamp: 3000,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
      card: {
        type: 'ask_question',
        questionId: 'approval-1',
        title: 'Install MCP server',
        question: 'Add memory server?',
        options: [{ label: 'Approve', value: 'approve' }],
        status: 'pending',
      },
    });
    const msgs = getMessages('inbox', MAIN_THREAD);
    expect(msgs[0]?.card).toMatchObject({
      questionId: 'approval-1',
      status: 'pending',
    });
  });

  it('finds and updates messages by questionId', () => {
    appendMessage({
      id: 'web-card-2',
      direction: 'outbound',
      text: 'Restart',
      timestamp: 4000,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
      card: {
        type: 'ask_question',
        questionId: 'q-restart',
        title: 'Restart',
        question: 'Allow restart?',
        options: [{ label: 'Approve', selectedLabel: '✅ Approved', value: 'approve' }],
        status: 'pending',
      },
    });
    const found = findMessageByQuestionId('inbox', MAIN_THREAD, 'q-restart');
    expect(found?.id).toBe('web-card-2');

    const updated = updateMessageCard('web-card-2', {
      ...found!.card!,
      status: 'answered',
      selectedValue: 'approve',
      selectedLabel: '✅ Approved',
    });
    expect(updated?.card?.status).toBe('answered');
    expect(getMessages('inbox', MAIN_THREAD)[0]?.card?.selectedValue).toBe('approve');
  });

  it('finds all mirrored messages by questionId across rooms', () => {
    appendMessage({
      id: 'web-card-inbox',
      direction: 'outbound',
      text: 'Restart',
      timestamp: 4100,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
      card: {
        type: 'ask_question',
        questionId: 'q-shared',
        title: 'Restart',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
        status: 'pending',
      },
    });
    appendMessage({
      id: 'web-card-dm',
      direction: 'outbound',
      text: 'Restart',
      timestamp: 4101,
      platformId: 'dm:sarah',
      threadId: MAIN_THREAD,
      card: {
        type: 'ask_question',
        questionId: 'q-shared',
        title: 'Restart',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
        status: 'pending',
      },
    });

    const matches = findMessagesByQuestionId('q-shared');
    expect(matches.map((m) => m.id).sort()).toEqual(['web-card-dm', 'web-card-inbox']);
  });

  it('findMessagesByQuestionId skips corrupt card_json rows', () => {
    appendMessage({
      id: 'web-card-valid',
      direction: 'outbound',
      text: 'Restart',
      timestamp: 4200,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
      card: {
        type: 'ask_question',
        questionId: 'q-filter',
        title: 'Restart',
        question: 'Allow restart?',
        options: [{ label: 'Approve', value: 'approve' }],
        status: 'pending',
      },
    });
    appendMessage({
      id: 'web-card-corrupt',
      direction: 'outbound',
      text: 'bad',
      timestamp: 4201,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
    });
    const db = new Database(webchatDbPath());
    try {
      db.prepare('UPDATE web_messages SET card_json = ? WHERE id = ?').run('{bad json', 'web-card-corrupt');
    } finally {
      db.close();
    }

    expect(findMessagesByQuestionId('q-filter').map((m) => m.id)).toEqual(['web-card-valid']);
  });

  it('ignores corrupt card_json when reading messages', () => {
    appendMessage({
      id: 'web-bad-card',
      direction: 'outbound',
      text: 'bad',
      timestamp: 5000,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
    });
    const db = new Database(webchatDbPath());
    try {
      db.prepare('UPDATE web_messages SET card_json = ? WHERE id = ?').run('{not json', 'web-bad-card');
    } finally {
      db.close();
    }
    const msgs = getMessages('inbox', MAIN_THREAD);
    expect(msgs.find((m) => m.id === 'web-bad-card')?.card).toBeUndefined();
  });

  it('returns undefined when questionId is not found', () => {
    appendMessage({
      id: 'web-other-card',
      direction: 'outbound',
      text: 'Other',
      timestamp: 6000,
      platformId: 'inbox',
      threadId: MAIN_THREAD,
      card: {
        type: 'ask_question',
        questionId: 'other-id',
        title: 'Other',
        question: 'Other?',
        options: [{ label: 'Yes', value: 'yes' }],
      },
    });
    expect(findMessageByQuestionId('inbox', MAIN_THREAD, 'missing')).toBeUndefined();
  });

  it('returns undefined when updateMessageCard targets a missing message', () => {
    expect(
      updateMessageCard('missing-id', {
        type: 'ask_question',
        questionId: 'q',
        title: 't',
        question: 'q',
        options: [],
      }),
    ).toBeUndefined();
  });
});

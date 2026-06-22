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
  getEngagedAgents,
  getMessageAttachmentPath,
  getMessages,
  getRecentMessages,
  hasBackfillDelivered,
  listThreads,
  MAIN_THREAD,
  markBackfillDelivered,
  removeEngagedAgent,
  upsertThread,
  webchatDbPath,
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
});

import { describe, expect, it, vi } from 'vitest';
import * as api from './api';
import {
  activeUnreadKey,
  appendThreadToRoomMap,
  applyLiveMessage,
  dedupeMessagesById,
  applyUnreadFromMessages,
  canCreateThread,
  canSendMessage,
  clearUnread,
  DEFAULT_ROOM_THREADS,
  formatUnreadCount,
  formatUnreadAriaLabel,
  getUnreadCount,
  incrementUnread,
  isActiveConversation,
  markMessagesSeen,
  mergeUnreadDeltas,
  migrateLegacyThreads,
  reconcileOptimisticMessage,
  dropPendingOptimisticId,
  defaultRoomThreads,
  resolveActiveThreadTitle,
  seedSyncCursors,
  shouldAppendMessage,
  syncInactiveUnread,
  threadsForRoom,
  threadsFromState,
  trackSeenMessageId,
  unreadKey,
  updateSyncCursor,
  SEEN_MESSAGE_IDS_MAX,
} from './app-helpers';
import type { BootstrapPayload, WebChatMessage, WebChatRoom } from './types';

const room: WebChatRoom = {
  platformId: 'lobby-1',
  name: 'Lobby',
  kind: 'lobby',
};

const message: WebChatMessage = {
  id: 'msg-1',
  direction: 'outbound',
  text: 'Hello',
  timestamp: 1,
  platformId: 'lobby-1',
  threadId: 'main',
};

describe('app-helpers', () => {
  describe('canSendMessage', () => {
    it('returns false when token is missing', () => {
      expect(canSendMessage('', room, 'hello', false)).toBe(false);
    });

    it('returns false when room is missing', () => {
      expect(canSendMessage('token', null, 'hello', false)).toBe(false);
    });

    it('returns false when draft is blank and there are no attachments', () => {
      expect(canSendMessage('token', room, '   ', false)).toBe(false);
      expect(canSendMessage('token', room, '   ', false, 0)).toBe(false);
    });

    it('returns true when attachments are present without draft text', () => {
      expect(canSendMessage('token', room, '   ', false, 1)).toBe(true);
    });

    it('returns false while a send is in flight', () => {
      expect(canSendMessage('token', room, 'hello', true)).toBe(false);
    });

    it('returns true when all send preconditions are met', () => {
      expect(canSendMessage('token', room, 'hello', false)).toBe(true);
    });
  });

  describe('canCreateThread', () => {
    it('returns false without a room', () => {
      expect(canCreateThread(null)).toBe(false);
    });

    it('returns true with a room', () => {
      expect(canCreateThread(room)).toBe(true);
    });
  });

  describe('shouldAppendMessage', () => {
    it('returns false for duplicate message ids', () => {
      expect(shouldAppendMessage([message], message, room, 'main')).toBe(false);
    });

    it('returns false when room is missing', () => {
      expect(shouldAppendMessage([], message, null, 'main')).toBe(false);
    });

    it('returns false for other rooms or threads', () => {
      expect(
        shouldAppendMessage([], { ...message, platformId: 'other' }, room, 'main'),
      ).toBe(false);
      expect(
        shouldAppendMessage([], { ...message, threadId: 'other' }, room, 'main'),
      ).toBe(false);
    });

    it('returns true for a new message in the active room and thread', () => {
      expect(shouldAppendMessage([], message, room, 'main')).toBe(true);
    });
  });

  describe('resolveActiveThreadTitle', () => {
    it('returns null for the main thread or unknown thread ids', () => {
      expect(resolveActiveThreadTitle([{ id: 'main', title: 'Main' }], 'main')).toBeNull();
      expect(resolveActiveThreadTitle([{ id: 'main', title: 'Main' }], 'missing')).toBeNull();
      expect(resolveActiveThreadTitle(undefined, 'thread_b')).toBeNull();
    });

    it('returns the title for a known child thread', () => {
      expect(
        resolveActiveThreadTitle(
          [
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ],
          'thread_b',
        ),
      ).toBe('Thread B');
    });
  });

  describe('threadsFromState', () => {
    it('returns an empty list when a room is missing from state', () => {
      expect(threadsFromState({}, 'lobby-1')).toEqual([]);
    });

    it('returns stored threads when present', () => {
      const threads = [{ id: 'main', title: 'Main' }];
      expect(threadsFromState({ 'lobby-1': threads }, 'lobby-1')).toBe(threads);
    });
  });

  describe('threadsForRoom', () => {
    it('loads threads when a room is missing from state', () => {
      const loaded = [{ id: 'main', title: 'Main' }];
      const loadRoomThreads = vi.fn(() => loaded);

      expect(threadsForRoom({}, 'lobby-2', loadRoomThreads)).toBe(loaded);
      expect(loadRoomThreads).toHaveBeenCalledWith('lobby-2');
    });

    it('prefers in-memory threads over loading from storage', () => {
      const inMemory = [{ id: 'thread_a', title: 'Thread A' }];
      const loadRoomThreads = vi.fn(() => [{ id: 'main', title: 'Main' }]);

      expect(threadsForRoom({ 'lobby-1': inMemory }, 'lobby-1', loadRoomThreads)).toBe(inMemory);
      expect(loadRoomThreads).not.toHaveBeenCalled();
    });
  });

  describe('unread helpers', () => {
    it('builds stable unread keys', () => {
      expect(unreadKey('lobby-1', 'main')).toBe('lobby-1|main');
      expect(unreadKey('dm:rahul', 'main')).toBe('dm:rahul|main');
    });

    it('detects active conversations', () => {
      expect(isActiveConversation(message, room, 'main')).toBe(true);
      expect(isActiveConversation({ ...message, platformId: 'other' }, room, 'main')).toBe(false);
      expect(isActiveConversation({ ...message, threadId: 'other' }, room, 'main')).toBe(false);
      expect(isActiveConversation(message, null, 'main')).toBe(false);
    });

    it('increments unread for non-active conversations', () => {
      const next = incrementUnread({}, message);
      expect(next).toEqual({ 'lobby-1|main': 1 });
    });

    it('tracks seen message ids with a bounded set size', () => {
      const seenIds = new Set<string>();
      trackSeenMessageId(seenIds, 'msg-1');
      trackSeenMessageId(seenIds, 'msg-1');
      expect(seenIds.size).toBe(1);
      for (let i = 0; i < SEEN_MESSAGE_IDS_MAX + 5; i += 1) {
        trackSeenMessageId(seenIds, `msg-${i}`);
      }
      expect(seenIds.size).toBe(SEEN_MESSAGE_IDS_MAX);
      expect(seenIds.has('msg-0')).toBe(false);
      expect(seenIds.has(`msg-${SEEN_MESSAGE_IDS_MAX + 4}`)).toBe(true);
    });

    it('merges unread deltas while excluding the active conversation', () => {
      expect(
        mergeUnreadDeltas({ 'lobby-1|main': 1 }, { 'lobby-1|main': 2, 'dm-sarah|main': 1 }, 'lobby-1|main'),
      ).toEqual({ 'lobby-1|main': 1, 'dm-sarah|main': 1 });
    });

    it('returns null active unread keys without a room', () => {
      expect(activeUnreadKey(null, 'main')).toBeNull();
      expect(activeUnreadKey(room, 'main')).toBe('lobby-1|main');
    });

    it('does not double increment duplicate message ids during apply', () => {
      const seenIds = new Set(['msg-1']);
      expect(applyUnreadFromMessages({ 'lobby-1|main': 1 }, [message], seenIds)).toEqual({
        counts: { 'lobby-1|main': 1 },
        maxTimestamp: message.timestamp,
      });
    });

    it('keeps main and child thread counts independent', () => {
      const seenIds = new Set<string>();
      const childMessage = { ...message, id: 'msg-2', threadId: 'thread_b' };
      let counts = incrementUnread({}, message);
      trackSeenMessageId(seenIds, message.id);
      trackSeenMessageId(seenIds, childMessage.id);
      counts = incrementUnread(counts, childMessage);
      expect(counts).toEqual({ 'lobby-1|main': 1, 'lobby-1|thread_b': 1 });
    });

    it('clears unread for a specific thread', () => {
      expect(clearUnread({ 'lobby-1|main': 2, 'lobby-1|thread_b': 1 }, 'lobby-1', 'main')).toEqual({
        'lobby-1|thread_b': 1,
      });
      expect(clearUnread({}, 'lobby-1', 'main')).toEqual({});
    });

    it('returns unread counts with zero fallback', () => {
      expect(getUnreadCount({ 'lobby-1|main': 3 }, 'lobby-1', 'main')).toBe(3);
      expect(getUnreadCount({}, 'lobby-1', 'main')).toBe(0);
    });

    it('formats unread counts with a cap', () => {
      expect(formatUnreadCount(5)).toBe('5');
      expect(formatUnreadCount(100)).toBe('99+');
    });

    it('formats unread aria labels with singular and plural forms', () => {
      expect(formatUnreadAriaLabel('Sarah', 0)).toBe('Sarah');
      expect(formatUnreadAriaLabel('Sarah', 1)).toBe('Sarah, 1 unread message');
      expect(formatUnreadAriaLabel('Sarah', 2)).toBe('Sarah, 2 unread messages');
      expect(formatUnreadAriaLabel('Sarah', 100)).toBe('Sarah, 99+ unread messages');
    });

    it('applies unread from fetched messages', () => {
      const seenIds = new Set<string>();
      const childMessage = { ...message, id: 'msg-2', threadId: 'thread_b', timestamp: 42 };
      const result = applyUnreadFromMessages({}, [message, childMessage], seenIds);
      expect(result.counts).toEqual({ 'lobby-1|main': 1, 'lobby-1|thread_b': 1 });
      expect(result.maxTimestamp).toBe(42);
      expect(seenIds.size).toBe(2);
    });

    it('seeds sync cursors for every room thread', () => {
      const baseline = 1_700_000_000_000;
      const cursors = seedSyncCursors(
        {},
        [
          { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' },
          { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm' },
        ],
        {
          'lobby-1': [
            { id: 'main', title: 'Main' },
            { id: 'thread_b', title: 'Thread B' },
          ],
        },
        baseline,
      );
      expect(cursors).toEqual({
        'lobby-1|main': baseline,
        'lobby-1|thread_b': baseline,
        'dm-sarah|main': baseline,
      });
    });

    it('marks fetched messages as seen', () => {
      const seenIds = new Set<string>();
      expect(markMessagesSeen([message, { ...message, id: 'msg-2', timestamp: 42 }], seenIds)).toBe(42);
      expect(seenIds).toEqual(new Set(['msg-1', 'msg-2']));
    });

    it('updates sync cursors from fetched messages', () => {
      expect(updateSyncCursor({}, 'lobby-1', 'main', 0)).toEqual({});
      expect(updateSyncCursor({}, 'lobby-1', 'main', 42)).toEqual({ 'lobby-1|main': 42 });
      expect(updateSyncCursor({ 'lobby-1|main': 10 }, 'lobby-1', 'main', 5)).toEqual({
        'lobby-1|main': 10,
      });
    });

    it('syncs unread for inactive rooms from history', async () => {
      const bootstrap: BootstrapPayload = {
        user: { id: 'u1', displayName: 'Test User' },
        rooms: [
          { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' },
          { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm' },
        ],
        agents: [],
      };
      const seenIds = new Set<string>();
      const fetchMessagesFn = vi.fn(async (_token, platformId: string) => {
        if (platformId === 'dm-sarah') {
          return [{ ...message, id: 'sync-1', platformId: 'dm-sarah', timestamp: 100 }];
        }
        return [];
      });

      const result = await syncInactiveUnread(
        'token',
        bootstrap,
        { 'lobby-1': [{ id: 'main', title: 'Main' }] },
        room,
        'main',
        { 'lobby-1|main': 50, 'dm-sarah|main': 0 },
        seenIds,
        fetchMessagesFn,
      );

      expect(result.counts).toEqual({ 'dm-sarah|main': 1 });
      expect(result.syncCursor).toEqual({ 'lobby-1|main': 50, 'dm-sarah|main': 100 });
      expect(fetchMessagesFn).toHaveBeenCalledWith('token', 'dm-sarah', 'main', 0);
    });

    it('uses a recent baseline when a thread cursor is missing', async () => {
      const meiRoom: WebChatRoom = { platformId: 'dm-mei', name: 'Mei', kind: 'dm' };
      const bootstrap: BootstrapPayload = {
        user: { id: 'u1', displayName: 'Test User' },
        rooms: [meiRoom],
        agents: [],
      };
      const fetchMessagesFn = vi.fn(async (_token, _platformId, _threadId, since = 0) => {
        if (since < 5000) return [{ ...message, id: 'old-1', platformId: 'dm-mei', timestamp: 1 }];
        return [];
      });

      const result = await syncInactiveUnread(
        'token',
        bootstrap,
        {
          'dm-mei': [
            { id: 'main', title: 'Main' },
            { id: 'thread_orphan', title: 'Orphan' },
          ],
        },
        meiRoom,
        'main',
        { 'dm-mei|main': 1000 },
        new Set(),
        fetchMessagesFn,
        5000,
      );

      expect(fetchMessagesFn).not.toHaveBeenCalledWith(
        'token',
        'dm-mei',
        'main',
        expect.anything(),
      );
      expect(fetchMessagesFn).toHaveBeenCalledWith('token', 'dm-mei', 'thread_orphan', 5000);
      expect(result.counts).toEqual({});
    });

    it('ignores active conversations and sync failures', async () => {
      const bootstrap: BootstrapPayload = {
        user: { id: 'u1', displayName: 'Test User' },
        rooms: [
          { platformId: 'lobby-1', name: 'Lobby', kind: 'lobby' },
          { platformId: 'dm-sarah', name: 'Sarah', kind: 'dm' },
        ],
        agents: [],
      };
      const fetchMessagesFn = vi.fn(async (_token, platformId: string) => {
        if (platformId === 'dm-sarah') throw new Error('network');
        return [];
      });

      await expect(
        syncInactiveUnread(
          'token',
          bootstrap,
          {},
          room,
          'main',
          { 'dm-sarah|main': 0 },
          new Set(),
          fetchMessagesFn,
        ),
      ).resolves.toEqual({ counts: {}, syncCursor: { 'dm-sarah|main': 0 } });
      expect(fetchMessagesFn).toHaveBeenCalledWith('token', 'dm-sarah', 'main', 0);
    });
  });

  describe('defaultRoomThreads', () => {
    it('returns the default main thread list', () => {
      expect(defaultRoomThreads('lobby-1')).toEqual(DEFAULT_ROOM_THREADS);
    });
  });

  describe('appendThreadToRoomMap', () => {
    it('appends to default threads when the room is missing from the map', () => {
      expect(
        appendThreadToRoomMap({}, 'lobby-1', { id: 'thread_1', title: 'Thread 1' }),
      ).toEqual({
        'lobby-1': [...DEFAULT_ROOM_THREADS, { id: 'thread_1', title: 'Thread 1' }],
      });
    });
  });

  describe('applyLiveMessage', () => {
    it('ignores messages for other conversations', () => {
      expect(applyLiveMessage([], message, null, 'main', null)).toEqual([]);
    });

    it('appends when there is no pending optimistic message', () => {
      expect(applyLiveMessage([], message, room, 'main', null)).toEqual([message]);
    });

    it('replaces a pending optimistic message instead of duplicating the websocket echo', () => {
      const optimistic = { ...message, id: 'local-1', direction: 'inbound' as const, text: 'hello' };
      const persisted = { ...message, id: 'web-1', direction: 'inbound' as const, text: 'hello' };
      expect(
        applyLiveMessage([optimistic], persisted, room, 'main', 'local-1'),
      ).toEqual([persisted]);
    });

    it('dedupes when the persisted message is already present', () => {
      const persisted = { ...message, id: 'web-1', direction: 'inbound' as const, text: 'hello' };
      expect(applyLiveMessage([persisted], persisted, room, 'main', 'local-1')).toEqual([persisted]);
    });
  });

  describe('dedupeMessagesById', () => {
    it('removes later messages that share an id', () => {
      const first = { ...message, id: 'web-1' };
      const second = { ...message, id: 'web-1', text: 'duplicate' };
      expect(dedupeMessagesById([first, second])).toEqual([first]);
    });
  });

  describe('dropPendingOptimisticId', () => {
    it('no-ops when the thread queue is missing', () => {
      const pending: Record<string, string[]> = {};
      dropPendingOptimisticId(pending, 'lobby-1', 'main', 'local-1');
      expect(pending).toEqual({});
    });

    it('removes the queue entry when the last pending id is dropped', () => {
      const pending: Record<string, string[]> = { 'lobby-1|main': ['local-1'] };
      dropPendingOptimisticId(pending, 'lobby-1', 'main', 'local-1');
      expect(pending).toEqual({});
    });

    it('keeps remaining pending ids when dropping one of several', () => {
      const pending: Record<string, string[]> = { 'lobby-1|main': ['local-1', 'local-2'] };
      dropPendingOptimisticId(pending, 'lobby-1', 'main', 'local-1');
      expect(pending).toEqual({ 'lobby-1|main': ['local-2'] });
    });
  });

  describe('reconcileOptimisticMessage', () => {
    it('updates the optimistic row when the server message is not already present', () => {
      const optimistic = { ...message, id: 'local-1', direction: 'inbound' as const, text: 'hello' };
      expect(
        reconcileOptimisticMessage([optimistic], 'local-1', { messageId: 'web-1', timestamp: 2 }),
      ).toEqual([{ ...optimistic, id: 'web-1', timestamp: 2 }]);
    });

    it('dedupes when websocket echo arrived before the POST response', () => {
      const optimistic = { ...message, id: 'local-1', direction: 'inbound' as const, text: 'hello' };
      const echoed = { ...message, id: 'web-1', direction: 'inbound' as const, text: 'hello' };
      expect(
        reconcileOptimisticMessage([optimistic, echoed], 'local-1', {
          messageId: 'web-1',
          timestamp: 2,
        }),
      ).toEqual([echoed]);
    });
  });

  describe('migrateLegacyThreads', () => {
    it('uses default threads when the base map omits a room', async () => {
      localStorage.setItem(
        'webchat_threads:lobby-1',
        JSON.stringify([{ id: 'thread_legacy', title: 'Legacy topic' }]),
      );
      vi.spyOn(api, 'createThread').mockResolvedValue({ id: 'thread_new', title: 'Legacy topic' });

      const result = await migrateLegacyThreads('token', [room], {});

      expect(result['lobby-1']).toEqual([
        ...DEFAULT_ROOM_THREADS,
        { id: 'thread_new', title: 'Legacy topic' },
      ]);
      expect(localStorage.getItem('webchat_threads:lobby-1')).toBeNull();
    });
  });
});

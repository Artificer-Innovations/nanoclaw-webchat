import { describe, expect, it, vi } from 'vitest';
import {
  canCreateThread,
  canSendMessage,
  clearUnread,
  formatUnreadCount,
  getUnreadCount,
  incrementUnread,
  isActiveConversation,
  resolveActiveThreadTitle,
  shouldAppendMessage,
  threadsForRoom,
  threadsFromState,
  unreadKey,
} from './app-helpers';
import type { WebChatMessage, WebChatRoom } from './types';

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

    it('returns false when draft is blank', () => {
      expect(canSendMessage('token', room, '   ', false)).toBe(false);
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
      expect(unreadKey('lobby-1', 'main')).toBe('lobby-1:main');
    });

    it('detects active conversations', () => {
      expect(isActiveConversation(message, room, 'main')).toBe(true);
      expect(isActiveConversation({ ...message, platformId: 'other' }, room, 'main')).toBe(false);
      expect(isActiveConversation({ ...message, threadId: 'other' }, room, 'main')).toBe(false);
      expect(isActiveConversation(message, null, 'main')).toBe(false);
    });

    it('increments unread for non-active conversations', () => {
      const seenIds = new Set<string>();
      const next = incrementUnread({}, message, seenIds);
      expect(next).toEqual({ 'lobby-1:main': 1 });
      expect(seenIds.has('msg-1')).toBe(true);
    });

    it('does not double increment duplicate message ids', () => {
      const seenIds = new Set(['msg-1']);
      expect(incrementUnread({ 'lobby-1:main': 1 }, message, seenIds)).toEqual({ 'lobby-1:main': 1 });
    });

    it('keeps main and child thread counts independent', () => {
      const seenIds = new Set<string>();
      const childMessage = { ...message, id: 'msg-2', threadId: 'thread_b' };
      const counts = incrementUnread({}, message, seenIds);
      const next = incrementUnread(counts, childMessage, seenIds);
      expect(next).toEqual({ 'lobby-1:main': 1, 'lobby-1:thread_b': 1 });
    });

    it('clears unread for a specific thread', () => {
      expect(clearUnread({ 'lobby-1:main': 2, 'lobby-1:thread_b': 1 }, 'lobby-1', 'main')).toEqual({
        'lobby-1:thread_b': 1,
      });
      expect(clearUnread({}, 'lobby-1', 'main')).toEqual({});
    });

    it('returns unread counts with zero fallback', () => {
      expect(getUnreadCount({ 'lobby-1:main': 3 }, 'lobby-1', 'main')).toBe(3);
      expect(getUnreadCount({}, 'lobby-1', 'main')).toBe(0);
    });

    it('formats unread counts with a cap', () => {
      expect(formatUnreadCount(5)).toBe('5');
      expect(formatUnreadCount(100)).toBe('99+');
    });
  });
});

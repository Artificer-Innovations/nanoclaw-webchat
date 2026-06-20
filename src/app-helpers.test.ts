import { describe, expect, it, vi } from 'vitest';
import { canCreateThread, canSendMessage, resolveActiveThreadTitle, shouldAppendMessage, threadsForRoom, threadsFromState } from './app-helpers';
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
});

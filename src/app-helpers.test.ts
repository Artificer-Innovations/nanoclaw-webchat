import { describe, expect, it } from 'vitest';
import { canCreateThread, canSendMessage, shouldAppendMessage } from './app-helpers';
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
});

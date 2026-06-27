import { describe, expect, it } from 'vitest';
import {
  assertRoomAccess,
  encodeUserSuffix,
  inboxPlatformForUser,
  ownerUserIdFromPhysical,
  RoomAccessError,
  shouldDeliverWsEvent,
  toLogicalPlatformId,
  toPhysicalPlatformId,
} from './webchat-room-scope.js';

describe('webchat-room-scope', () => {
  const alice = 'web:basic:alice';

  it('maps lobby unchanged', () => {
    expect(toPhysicalPlatformId('lobby', alice)).toBe('lobby');
    expect(toLogicalPlatformId('lobby')).toBe('lobby');
  });

  it('scopes inbox and dm per user', () => {
    const inbox = toPhysicalPlatformId('inbox', alice);
    expect(inbox).toBe(`inbox:${encodeUserSuffix(alice)}`);
    expect(toLogicalPlatformId(inbox)).toBe('inbox');
    expect(ownerUserIdFromPhysical(inbox)).toBe(alice);

    const dm = toPhysicalPlatformId('dm:sarah', alice);
    expect(dm).toBe(`dm:sarah:${encodeUserSuffix(alice)}`);
    expect(toLogicalPlatformId(dm)).toBe('dm:sarah');
    expect(ownerUserIdFromPhysical(dm)).toBe(alice);
  });

  it('assertRoomAccess returns physical id for owner', () => {
    expect(assertRoomAccess('dm:sarah', alice)).toBe(`dm:sarah:${encodeUserSuffix(alice)}`);
  });

  it('assertRoomAccess rejects cross-user dm', () => {
    expect(() => assertRoomAccess('dm:sarah', 'web:basic:bob')).toThrow(RoomAccessError);
  });

  it('delivers lobby events to everyone', () => {
    expect(shouldDeliverWsEvent({ type: 'message', platformId: 'lobby' }, alice)).toBe(true);
    expect(shouldDeliverWsEvent({ type: 'message', platformId: 'lobby' }, 'web:basic:bob')).toBe(true);
  });

  it('scopes private events by forUserId', () => {
    const dm = toPhysicalPlatformId('dm:sarah', alice);
    const event = {
      type: 'message',
      forUserId: alice,
      message: { platformId: toLogicalPlatformId(dm) },
    };
    expect(shouldDeliverWsEvent(event, alice)).toBe(true);
    expect(shouldDeliverWsEvent(event, 'web:basic:bob')).toBe(false);
  });

  it('inboxPlatformForUser matches physical inbox id', () => {
    expect(inboxPlatformForUser(alice)).toBe(toPhysicalPlatformId('inbox', alice));
  });
});

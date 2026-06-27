/**
 * Slack-like room scoping: shared lobby, per-user DMs and inbox.
 */

export const WEB_LOBBY_PLATFORM_ID = 'lobby';
export const WEB_INBOX_PLATFORM_ID = 'inbox';

export type RoomKind = 'lobby' | 'inbox' | 'dm';

const USER_SEP = '~';

/** Encode userId for use in physical platform_id (colons → tildes). */
export function encodeUserSuffix(userId: string): string {
  return userId.replace(/:/g, USER_SEP);
}

export function decodeUserSuffix(encoded: string): string {
  return encoded.replace(/~/g, ':');
}

export function isSharedRoom(logicalPlatformId: string): boolean {
  return logicalPlatformId === WEB_LOBBY_PLATFORM_ID;
}

export function roomKindFromLogical(logicalPlatformId: string): RoomKind {
  if (logicalPlatformId === WEB_LOBBY_PLATFORM_ID) return 'lobby';
  if (logicalPlatformId === WEB_INBOX_PLATFORM_ID) return 'inbox';
  if (logicalPlatformId.startsWith('dm:')) return 'dm';
  throw new Error(`Unknown room: ${logicalPlatformId}`);
}

/** Logical API id → physical storage / messaging group id. */
export function toPhysicalPlatformId(logicalPlatformId: string, userId: string): string {
  const kind = roomKindFromLogical(logicalPlatformId);
  const suffix = encodeUserSuffix(userId);
  if (kind === 'lobby') return WEB_LOBBY_PLATFORM_ID;
  if (kind === 'inbox') return `${WEB_INBOX_PLATFORM_ID}:${suffix}`;
  const folder = logicalPlatformId.slice('dm:'.length);
  if (!folder) throw new Error('Invalid DM platform id');
  return `dm:${folder}:${suffix}`;
}

/** Physical id → logical id for UI/API (lobby unchanged). */
export function toLogicalPlatformId(physicalPlatformId: string): string {
  if (physicalPlatformId === WEB_LOBBY_PLATFORM_ID) return WEB_LOBBY_PLATFORM_ID;
  if (physicalPlatformId.startsWith(`${WEB_INBOX_PLATFORM_ID}:`)) return WEB_INBOX_PLATFORM_ID;
  const dmMatch = physicalPlatformId.match(/^dm:([^:]+):(.+)$/);
  if (dmMatch) return `dm:${dmMatch[1]}`;
  if (physicalPlatformId.startsWith('dm:')) return physicalPlatformId;
  return physicalPlatformId;
}

export function ownerUserIdFromPhysical(physicalPlatformId: string): string | null {
  if (physicalPlatformId === WEB_LOBBY_PLATFORM_ID) return null;
  if (physicalPlatformId.startsWith(`${WEB_INBOX_PLATFORM_ID}:`)) {
    return decodeUserSuffix(physicalPlatformId.slice(WEB_INBOX_PLATFORM_ID.length + 1));
  }
  const dmMatch = physicalPlatformId.match(/^dm:[^:]+:(.+)$/);
  if (dmMatch) return decodeUserSuffix(dmMatch[1]!);
  return null;
}

export function assertRoomAccess(logicalPlatformId: string, sessionUserId: string): string {
  const physical = toPhysicalPlatformId(logicalPlatformId, sessionUserId);
  const owner = ownerUserIdFromPhysical(physical);
  if (owner !== null && owner !== sessionUserId) {
    throw new RoomAccessError(logicalPlatformId);
  }
  return physical;
}

export class RoomAccessError extends Error {
  constructor(public readonly logicalPlatformId: string) {
    super('Forbidden');
    this.name = 'RoomAccessError';
  }
}

export function inboxPlatformForUser(userId: string): string {
  return toPhysicalPlatformId(WEB_INBOX_PLATFORM_ID, userId);
}

export interface WsDeliveryContext {
  platformId: string;
  threadId?: string;
}

/** Whether a WS event should be delivered to a connected client. */
export function shouldDeliverWsEvent(
  event: {
    type: string;
    platformId?: string;
    forUserId?: string;
    message?: { platformId?: string };
  },
  clientUserId: string,
): boolean {
  if (event.forUserId) return event.forUserId === clientUserId;

  const platformId =
    event.platformId ??
    (event.message && typeof event.message === 'object' ? event.message.platformId : undefined);
  if (!platformId) return true;
  const logical = toLogicalPlatformId(platformId);
  if (isSharedRoom(logical)) return true;
  const owner = ownerUserIdFromPhysical(platformId);
  if (owner) return owner === clientUserId;
  // Logical private room id in client payload — cannot determine owner without forUserId
  return false;
}

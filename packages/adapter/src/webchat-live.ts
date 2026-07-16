/**
 * Live refresh after agent-group changes (create_agent, groups-delete, etc.).
 *
 * Re-syncs lobby/DM wirings and nudges connected webchat clients to soft-merge
 * an updated bootstrap payload so DMs appear/disappear without a host restart.
 */
import { log } from './log.js';
import { getUser } from './modules/permissions/db/users.js';
import { buildWebchatBootstrap, syncWebchatWirings, type WebchatBootstrapPayload } from './webchat-sync.js';

type BootstrapBroadcaster = () => void;

let broadcaster: BootstrapBroadcaster | null = null;

/** Register the active web adapter's bootstrap broadcaster (cleared on stop). */
export function setWebchatBootstrapBroadcaster(next: BootstrapBroadcaster | null): void {
  broadcaster = next;
}

/** Sync wirings and push an updated room list to connected browsers. */
export function refreshWebchatAfterAgentChange(): void {
  try {
    syncWebchatWirings();
  } catch (err) {
    log.error('Webchat live refresh: sync failed', { err });
    return;
  }

  if (!broadcaster) return;

  try {
    broadcaster();
  } catch (err) {
    log.warn('Webchat live refresh: broadcast failed', { err });
  }
}

/**
 * Build a bootstrap payload for one connected user. Used by the web adapter's
 * fan-out when refreshing after agent changes.
 */
export function bootstrapPayloadForUser(userId: string): WebchatBootstrapPayload {
  const user = getUser(userId);
  const displayName = user?.display_name?.trim() || userId;
  return buildWebchatBootstrap(userId, displayName);
}

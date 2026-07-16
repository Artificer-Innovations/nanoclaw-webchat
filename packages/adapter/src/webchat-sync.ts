/**
 * Idempotent wiring sync for the web chat channel.
 *
 * Ensures lobby + per-agent DM messaging groups exist and every agent_group
 * is wired with @<folder> patterns in the lobby. Re-run on host boot so new
 * agents are picked up automatically.
 */
import { readEnvFile } from './env.js';
import { getAllAgentGroups } from './db/agent-groups.js';
import {
  createMessagingGroup,
  createMessagingGroupAgent,
  getMessagingGroup,
  getMessagingGroupByPlatform,
  getMessagingGroupAgentByPair,
  updateMessagingGroup,
  updateMessagingGroupAgent,
} from './db/messaging-groups.js';
import { log } from './log.js';
import { listThreads, type WebchatThreadMeta } from './webchat-store.js';
import {
  inboxPlatformForUser,
  toPhysicalPlatformId,
  WEB_INBOX_PLATFORM_ID,
  WEB_LOBBY_PLATFORM_ID,
} from './webchat-room-scope.js';
import { getAllUsers, upsertUser } from './modules/permissions/db/users.js';
import { addMember } from './modules/permissions/db/agent-group-members.js';
import { grantRole, isGlobalAdmin, isOwner, revokeRole } from './modules/permissions/db/user-roles.js';
import { deleteUserDm, getUserDm, upsertUserDm } from './modules/permissions/db/user-dms.js';
import type { AgentGroup } from './types.js';

export { WEB_LOBBY_PLATFORM_ID, WEB_INBOX_PLATFORM_ID };

export const WEB_CHANNEL_TYPE = 'web';

function readAuthMode(): 'local' | 'public' {
  const env = readEnvFile(['WEBCHAT_AUTH_MODE']);
  const raw = process.env.WEBCHAT_AUTH_MODE || env.WEBCHAT_AUTH_MODE || 'local';
  return raw === 'public' ? 'public' : 'local';
}

function readLocalWebUserId(): string {
  const env = readEnvFile(['WEBCHAT_USER_ID']);
  return process.env.WEBCHAT_USER_ID || env.WEBCHAT_USER_ID || 'web:local';
}

/** Legacy local-mode operator identity — must not remain an approval owner in public mode. */
function isLegacyLocalWebUser(userId: string): boolean {
  return userId === 'web:local' || userId === readLocalWebUserId();
}

/** Drop cached DM rows that still point at the shared local `inbox` platform id. */
function clearStaleSharedInboxUserDm(userId: string): void {
  const cached = getUserDm(userId, WEB_CHANNEL_TYPE);
  if (!cached) return;
  const mg = getMessagingGroup(cached.messaging_group_id);
  if (!mg || mg.platform_id !== WEB_INBOX_PLATFORM_ID) return;
  deleteUserDm(userId, WEB_CHANNEL_TYPE);
  log.info('Webchat sync: cleared stale shared-inbox user_dm', { userId, messagingGroupId: mg.id });
}

/**
 * In public mode, revoke owner/admin on the legacy local web identity and clear
 * user_dms rows still targeting bare `inbox` so approval cards route to real logins.
 */
export function revokeLegacyLocalWebApprovers(): void {
  if (readAuthMode() !== 'public') return;

  const ids = new Set<string>(['web:local', readLocalWebUserId()]);
  for (const userId of ids) {
    if (isOwner(userId)) {
      revokeRole(userId, 'owner', null);
      log.info('Webchat sync: revoked legacy local web owner in public mode', { userId });
    }
    if (isGlobalAdmin(userId)) {
      revokeRole(userId, 'admin', null);
      log.info('Webchat sync: revoked legacy local web admin in public mode', { userId });
    }
  }

  // Stale shared-inbox caches can exist for *any* web user (e.g. web:System after
  // openDM previously returned bare `inbox`). Clear them so ensureUserDm re-resolves.
  for (const user of getAllUsers().filter((u) => u.kind === 'web')) {
    clearStaleSharedInboxUserDm(user.id);
  }
}

/**
 * Public login allowlist is the privilege gate: admitted users become owners so
 * they can approve create_agent / install cards without knowing opaque OIDC ids.
 * Follow-up: privilege tiers for broad domain-allowlist multi-user hosts.
 */
export function ensurePublicWebOwner(userId: string): void {
  if (readAuthMode() !== 'public') return;
  if (isLegacyLocalWebUser(userId)) return;
  if (isOwner(userId)) return;
  grantRole({
    user_id: userId,
    role: 'owner',
    agent_group_id: null,
    granted_by: null,
    granted_at: new Date().toISOString(),
  });
  log.info('Webchat sync: granted owner to public web user', { userId });
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dmPlatformId(folder: string): string {
  return `dm:${folder}`;
}

function lobbyPattern(folder: string): string {
  return `@${folder}\\b`;
}

function ensureLobbyMessagingGroup(): string {
  let mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID);
  if (!mg) {
    const id = generateId('mg');
    createMessagingGroup({
      id,
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: WEB_LOBBY_PLATFORM_ID,
      name: 'Lobby',
      is_group: 1,
      unknown_sender_policy: 'strict',
      created_at: new Date().toISOString(),
    });
    mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)!;
    log.info('Webchat sync: created lobby messaging group', { id: mg.id });
  }
  return mg.id;
}

function ensureDmMessagingGroupForPlatform(platformId: string, name: string): string {
  let mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, platformId);
  if (!mg) {
    const id = generateId('mg');
    createMessagingGroup({
      id,
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: platformId,
      name,
      is_group: 0,
      unknown_sender_policy: 'strict',
      created_at: new Date().toISOString(),
    });
    mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, platformId)!;
    log.info('Webchat sync: created DM messaging group', { platformId, id: mg.id });
  } else if (mg.is_group !== 0) {
    updateMessagingGroup(mg.id, { is_group: 0 });
    mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, platformId)!;
  }
  return mg.id;
}

function ensureDmMessagingGroup(agent: AgentGroup): string {
  const platformId = dmPlatformId(agent.folder);
  return ensureDmMessagingGroupForPlatform(platformId, agent.name);
}

function ensureInboxMessagingGroupForPlatform(platformId: string): string {
  let mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, platformId);
  if (!mg) {
    const id = generateId('mg');
    createMessagingGroup({
      id,
      channel_type: WEB_CHANNEL_TYPE,
      platform_id: platformId,
      name: 'Inbox',
      is_group: 0,
      unknown_sender_policy: 'strict',
      created_at: new Date().toISOString(),
    });
    mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, platformId)!;
    log.info('Webchat sync: created inbox messaging group', { platformId, id: mg.id });
  } else if (mg.is_group !== 0) {
    updateMessagingGroup(mg.id, { is_group: 0 });
    mg = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, platformId)!;
  }
  return mg.id;
}

function upsertLobbyWiring(lobbyMgId: string, agentGroupId: string, engagePattern: string): void {
  const existing = getMessagingGroupAgentByPair(lobbyMgId, agentGroupId);
  if (existing) {
    updateMessagingGroupAgent(existing.id, {
      engage_mode: 'pattern',
      engage_pattern: engagePattern,
      session_mode: 'per-thread',
    });
    return;
  }
  createMessagingGroupAgent({
    id: generateId('mga'),
    messaging_group_id: lobbyMgId,
    agent_group_id: agentGroupId,
    engage_mode: 'pattern',
    engage_pattern: engagePattern,
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'per-thread',
    priority: 0,
    created_at: new Date().toISOString(),
  });
}

function upsertDmWiring(dmMgId: string, agentGroupId: string): void {
  const existing = getMessagingGroupAgentByPair(dmMgId, agentGroupId);
  if (existing) {
    updateMessagingGroupAgent(existing.id, {
      engage_mode: 'pattern',
      engage_pattern: '.',
      session_mode: 'per-thread',
    });
    return;
  }
  createMessagingGroupAgent({
    id: generateId('mga'),
    messaging_group_id: dmMgId,
    agent_group_id: agentGroupId,
    engage_mode: 'pattern',
    engage_pattern: '.',
    sender_scope: 'all',
    ignored_message_policy: 'drop',
    session_mode: 'per-thread',
    priority: 0,
    created_at: new Date().toISOString(),
  });
}

function ensureWebUser(userId: string, displayName: string): void {
  upsertUser({
    id: userId,
    kind: 'web',
    display_name: displayName,
    created_at: new Date().toISOString(),
  });
}

function ensureMemberAccess(userId: string, agentGroupId: string): void {
  addMember({
    user_id: userId,
    agent_group_id: agentGroupId,
    added_by: null,
    added_at: new Date().toISOString(),
  });
}

export interface EnsureUserWebchatWiringsOptions {
  /** Pre-fetched agent list (avoids N+1 queries during boot backfill). */
  agents?: AgentGroup[];
  /** Skip lobby wiring when the caller already synced lobby (boot backfill). */
  skipLobbyWiring?: boolean;
  /** Skip upsertUser so boot backfill does not mutate stored display names. */
  skipWebUserUpsert?: boolean;
}

/** Per-user inbox + DM messaging groups and permissions (public mode). Idempotent. */
export function ensureUserWebchatWirings(
  userId: string,
  displayName: string,
  options?: EnsureUserWebchatWiringsOptions,
): void {
  const teamFolder = readTeamFolder();
  if (!options?.skipWebUserUpsert) {
    ensureWebUser(userId, displayName);
  }

  if (readAuthMode() === 'public') {
    revokeLegacyLocalWebApprovers();
    ensurePublicWebOwner(userId);
  }

  const inboxPhysical = inboxPlatformForUser(userId);
  const inboxMgId = ensureInboxMessagingGroupForPlatform(inboxPhysical);
  // Keep host ensureUserDm cache aligned with the per-user inbox the UI loads.
  // Never cache delivery for the legacy local identity in public mode.
  clearStaleSharedInboxUserDm(userId);
  if (!isLegacyLocalWebUser(userId)) {
    upsertUserDm({
      user_id: userId,
      channel_type: WEB_CHANNEL_TYPE,
      messaging_group_id: inboxMgId,
      resolved_at: new Date().toISOString(),
    });
  }

  const lobbyMgId = getMessagingGroupByPlatform(WEB_CHANNEL_TYPE, WEB_LOBBY_PLATFORM_ID)?.id;
  const agents = options?.agents ?? getAllAgentGroups();

  for (const agent of agents) {
    ensureMemberAccess(userId, agent.id);

    const dmPhysical = toPhysicalPlatformId(`dm:${agent.folder}`, userId);
    const dmMgId = ensureDmMessagingGroupForPlatform(dmPhysical, agent.name);
    upsertDmWiring(dmMgId, agent.id);

    if (lobbyMgId && !options?.skipLobbyWiring) {
      const pattern =
        teamFolder && agent.folder === teamFolder ? `@(team|${agent.folder})\\b` : lobbyPattern(agent.folder);
      upsertLobbyWiring(lobbyMgId, agent.id, pattern);
    }
  }

  log.info('Webchat user wirings synced', { userId, agentCount: agents.length });
}

export interface WebchatBootstrapRoom {
  platformId: string;
  name: string;
  kind: 'lobby' | 'dm' | 'inbox';
  folder?: string;
  threads: WebchatThreadMeta[];
}

export interface WebchatBootstrapAgent {
  folder: string;
  name: string;
  mention: string;
}

export interface WebchatBootstrapPayload {
  user: { id: string; displayName: string };
  rooms: WebchatBootstrapRoom[];
  agents: WebchatBootstrapAgent[];
}

export function buildWebchatBootstrap(userId: string, displayName: string): WebchatBootstrapPayload {
  const agents = getAllAgentGroups();
  const teamFolder = readTeamFolder();
  const publicMode = readAuthMode() === 'public';

  const inboxPhysical = publicMode ? inboxPlatformForUser(userId) : WEB_INBOX_PLATFORM_ID;

  const rooms: WebchatBootstrapRoom[] = [
    {
      platformId: WEB_INBOX_PLATFORM_ID,
      name: 'Inbox',
      kind: 'inbox',
      threads: listThreads(inboxPhysical),
    },
    {
      platformId: WEB_LOBBY_PLATFORM_ID,
      name: 'Lobby',
      kind: 'lobby',
      threads: listThreads(WEB_LOBBY_PLATFORM_ID),
    },
    ...agents.map((a) => {
      const logical = dmPlatformId(a.folder);
      const storageId = publicMode ? toPhysicalPlatformId(logical, userId) : logical;
      return {
        platformId: logical,
        name: a.name,
        kind: 'dm' as const,
        folder: a.folder,
        threads: listThreads(storageId),
      };
    }),
  ];

  const agentList: WebchatBootstrapAgent[] = agents.map((a) => ({
    folder: a.folder,
    name: teamFolder && a.folder === teamFolder ? 'Team' : a.name,
    mention: teamFolder && a.folder === teamFolder ? '@team' : `@${a.folder}`,
  }));

  return {
    user: { id: userId, displayName },
    rooms,
    agents: agentList,
  };
}

export function readTeamFolder(): string | null {
  const env = readEnvFile(['WEBCHAT_TEAM_FOLDER']);
  const raw = process.env.WEBCHAT_TEAM_FOLDER || env.WEBCHAT_TEAM_FOLDER;
  return raw?.trim() || null;
}

/**
 * Ensure shared lobby messaging group + lobby @-mention wirings for every agent.
 * Idempotent (upserts). Cheap relative to per-user DM backfill.
 */
function syncLobbyWirings(agents: AgentGroup[]): string {
  const teamFolder = readTeamFolder();
  const lobbyMgId = ensureLobbyMessagingGroup();
  for (const agent of agents) {
    const pattern =
      teamFolder && agent.folder === teamFolder ? `@(team|${agent.folder})\\b` : lobbyPattern(agent.folder);
    upsertLobbyWiring(lobbyMgId, agent.id, pattern);
  }
  return lobbyMgId;
}

/**
 * Heal lobby + one user's inbox/DM wirings (CLI / non-create_agent paths).
 * Prefer this on per-request paths like GET /api/bootstrap — unlike
 * {@link syncWebchatWirings}, public mode does not backfill every web user.
 */
export function healWebchatWiringsForUser(userId: string, displayName: string): void {
  const env = readEnvFile(['WEBCHAT_ENABLED']);
  const enabled = process.env.WEBCHAT_ENABLED || env.WEBCHAT_ENABLED;
  if (!enabled || enabled === 'false') return;

  const agents = getAllAgentGroups();
  syncLobbyWirings(agents);
  ensureUserWebchatWirings(userId, displayName, { agents, skipLobbyWiring: true });
}

/**
 * Sync lobby + DM wirings for all agent groups. Idempotent.
 * Boot-time / full refresh only — public mode walks every web user (O(users)).
 * Prefer {@link healWebchatWiringsForUser} on request paths such as bootstrap.
 */
export function syncWebchatWirings(): void {
  const env = readEnvFile(['WEBCHAT_ENABLED', 'WEBCHAT_USER_ID', 'WEBCHAT_DISPLAY_NAME', 'WEBCHAT_AUTH_MODE']);
  const enabled = process.env.WEBCHAT_ENABLED || env.WEBCHAT_ENABLED;
  if (!enabled || enabled === 'false') return;

  const publicMode = readAuthMode() === 'public';
  const userId = process.env.WEBCHAT_USER_ID || env.WEBCHAT_USER_ID || 'web:local';
  const displayName = process.env.WEBCHAT_DISPLAY_NAME || env.WEBCHAT_DISPLAY_NAME || 'Local';

  const agents = getAllAgentGroups();
  const lobbyMgId = syncLobbyWirings(agents);

  if (publicMode) {
    revokeLegacyLocalWebApprovers();
    for (const user of getAllUsers().filter((u) => u.kind === 'web')) {
      try {
        ensureUserWebchatWirings(user.id, user.display_name ?? user.id, {
          agents,
          skipLobbyWiring: true,
          skipWebUserUpsert: true,
        });
      } catch (err) {
        log.error('Webchat sync: failed to wire user', { userId: user.id, err });
      }
    }
    log.info('Webchat wirings synced (public mode)', { agentCount: agents.length, lobbyMgId });
    return;
  }

  ensureWebUser(userId, displayName);
  ensureInboxMessagingGroupForPlatform(WEB_INBOX_PLATFORM_ID);

  for (const agent of agents) {
    ensureMemberAccess(userId, agent.id);
    const dmMgId = ensureDmMessagingGroup(agent);
    upsertDmWiring(dmMgId, agent.id);
  }

  log.info('Webchat wirings synced', { agentCount: agents.length, lobbyMgId });
}

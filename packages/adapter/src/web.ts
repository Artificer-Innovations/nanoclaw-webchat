/**
 * Web channel adapter — local browser chat via HTTP + WebSocket.
 *
 * Serves the nanoclaw-webchat SPA and exposes a small REST/WS API.
 * Routes patterns and DM rooms are wired by webchat-sync.ts; this adapter only
 * transports messages through the normal router/delivery path.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';

import { WebSocketServer, WebSocket, type WebSocket as WebSocketClient } from 'ws';

import { readEnvFile } from '../env.js';
import { getAgentGroup, getAllAgentGroups } from '../db/agent-groups.js';
import { getDb, hasTable } from '../db/connection.js';
import { getMessagingGroup, getMessagingGroupByPlatform } from '../db/messaging-groups.js';
import { getPendingApproval, getSession } from '../db/sessions.js';
import { log } from '../log.js';
import { buildWebchatBootstrap, ensureUserWebchatWirings, readTeamFolder, WEB_INBOX_PLATFORM_ID } from '../webchat-sync.js';
import type { PublicAuthConfig } from '../webchat-auth-config.js';
import { loadWebAdapterAuthConfig } from '../webchat-auth-config.js';
import {
  handlePublicAuthRequest,
  isPublicAuthExemptPath,
  isPublicAuthPath,
  resolveSessionUser,
} from '../webchat-auth.js';
import { ensureWebchatAuthSchema } from '../webchat-auth-sessions.js';
import {
  assertRoomAccess,
  inboxPlatformForUser,
  ownerUserIdFromPhysical,
  RoomAccessError,
  shouldDeliverWsEvent,
  toLogicalPlatformId,
  WEB_LOBBY_PLATFORM_ID,
} from '../webchat-room-scope.js';
import {
  backfillIntroLine,
  buildRoutingMetadata,
  folderFromSenderName,
  HISTORICAL_REPLAY_FIELD,
  readBackfillMessageLimit,
  roomContextStub,
  rosterJoinStub,
  ROSTER_STUB_FIELD,
  SYNTHETIC_KIND_FIELD,
  SYNTHETIC_MESSAGE_FIELD,
  THREAD_MESSAGE_SEQ_FIELD,
  WEBCHAT_RECEIVER_FIELD,
  type AgentNameRef,
} from '../webchat-routing.js';
import { implicitMentionedFolders, mentionedAgentFolders, type ImplicitMentionAgent } from '../webchat-mentions.js';
import {
  addEngagedAgents,
  appendMessage,
  appendMessageWithAttachmentMeta,
  createThread,
  deleteThreadData,
  deleteMessageFiles,
  ensureWebchatSchema,
  enrichMessagesWithAttachmentData,
  getEngagedAgents,
  getMessageAttachmentPath,
  getMessages,
  getRecentMessages,
  hasBackfillDelivered,
  listThreads,
  MAIN_THREAD,
  markBackfillDelivered,
  moveAttachmentIntoMessage,
  removeEngagedAgent,
  upsertThread,
  findMessageByQuestionId,
  answerCardsByQuestionId,
  revertCardsByQuestionId,
  writeAttachmentFiles,
  type StoredAttachmentMeta,
  type WebchatAskQuestionCard,
  type WebchatAttachmentInput,
  type WebchatCardOption,
  type WebchatStoredMessage,
} from '../webchat-store.js';
import {
  acceptChunk,
  CHUNK_SIZE,
  consumeStagedUpload,
  getStagedUpload,
  parseMultipartUpload,
  restoreStagedUpload,
  type StagedUpload,
} from '../webchat-uploads.js';
import { inferAttachmentMime, serveAttachmentFile } from '../webchat-serve-attachment.js';
import { cleanupAgentSessionsForThread } from '../webchat-thread-cleanup.js';
import { routeInbound } from '../router.js';
import { registerChannelAdapter } from './channel-registry.js';
import type { ChannelAdapter, ChannelSetup, InboundMessage, OutboundFile, OutboundMessage } from './adapter.js';

const CHANNEL_TYPE = 'web';
const MAX_ATTACHMENTS = 10;
const MAX_LEGACY_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_AGENT_INLINE_BYTES = 5 * 1024 * 1024;

interface WebChatAttachment {
  name: string;
  mimeType: string;
  type: 'image' | 'file';
  size?: number;
  data?: string;
  url?: string;
  uploadId?: string;
}

type InboundAttachment =
  | {
      kind: 'inline';
      name: string;
      mimeType: string;
      type: 'image' | 'file';
      size: number;
      data: string;
    }
  | {
      kind: 'upload';
      uploadId: string;
      name: string;
      mimeType: string;
      type: 'image' | 'file';
      size: number;
    };

interface WebAdapterOptions {
  port: number;
  bindAddress?: string;
  authMode: 'local' | 'public';
  authToken: string;
  userId: string;
  displayName: string;
  publicAuth?: PublicAuthConfig;
}

interface TrackedWsClient {
  ws: WebSocketClient;
  userId: string | null;
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    const c = content as { text?: unknown };
    if (typeof c.text === 'string') return c.text;
  }
  return '';
}

function extractSenderName(content: unknown): string | undefined {
  if (content && typeof content === 'object') {
    const name = (content as { senderName?: unknown }).senderName;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return undefined;
}

function extractSenderFolder(content: unknown): string | undefined {
  if (content && typeof content === 'object') {
    const folder = (content as { senderFolder?: unknown }).senderFolder;
    if (typeof folder === 'string' && folder.trim()) return folder.trim();
  }
  return undefined;
}

interface AskQuestionContent {
  type: 'ask_question';
  questionId: string;
  title: string;
  question: string;
  options: WebchatCardOption[];
}

function parseAskQuestionContent(content: unknown): AskQuestionContent | undefined {
  if (!content || typeof content !== 'object') return undefined;
  const c = content as Record<string, unknown>;
  if (c.type !== 'ask_question') return undefined;
  if (typeof c.questionId !== 'string' || !c.questionId.trim()) return undefined;
  if (typeof c.title !== 'string') return undefined;
  if (typeof c.question !== 'string') return undefined;
  if (!Array.isArray(c.options) || c.options.length === 0) return undefined;
  const options: WebchatCardOption[] = [];
  for (const raw of c.options) {
    if (!raw || typeof raw !== 'object') return undefined;
    const opt = raw as Record<string, unknown>;
    if (typeof opt.label !== 'string' || typeof opt.value !== 'string') return undefined;
    options.push({
      label: opt.label,
      value: opt.value,
      ...(typeof opt.selectedLabel === 'string' ? { selectedLabel: opt.selectedLabel } : {}),
    });
  }
  return {
    type: 'ask_question',
    questionId: c.questionId.trim(),
    title: c.title,
    question: c.question,
    options,
  };
}

function cardFallbackText(title: string, question: string): string {
  const parts = [title.trim(), question.trim()].filter(Boolean);
  return parts.join('\n');
}

function buildAskQuestionCard(parsed: AskQuestionContent): WebchatAskQuestionCard {
  return {
    type: 'ask_question',
    questionId: parsed.questionId,
    title: parsed.title,
    question: parsed.question,
    options: parsed.options,
    status: 'pending',
  };
}

interface ApprovalSessionOrigin {
  platformId: string;
  threadId: string;
  agentName?: string;
}

function resolveApprovalSessionOrigin(questionId: string): ApprovalSessionOrigin | undefined {
  try {
    const db = getDb();
    if (!hasTable(db, 'pending_approvals')) return undefined;
    const approval = getPendingApproval(questionId);
    if (!approval?.session_id) return undefined;
    const session = getSession(approval.session_id);
    if (!session?.messaging_group_id) return undefined;
    const mg = getMessagingGroup(session.messaging_group_id);
    if (!mg || mg.channel_type !== CHANNEL_TYPE) return undefined;
    const agent = getAgentGroup(session.agent_group_id);
    return {
      platformId: mg.platform_id,
      threadId: session.thread_id ?? MAIN_THREAD,
      agentName: agent?.name,
    };
  } catch (err) {
    log.warn('resolveApprovalSessionOrigin failed', { questionId, err });
    return undefined;
  }
}

function attachmentType(mimeType: string): 'image' | 'file' {
  return mimeType.startsWith('image/') ? 'image' : 'file';
}

function outboundFileToAttachment(file: OutboundFile): WebChatAttachment | null {
  if (file.data.length > MAX_LEGACY_ATTACHMENT_BYTES) {
    log.warn('Skipping oversize outbound attachment', { filename: file.filename, size: file.data.length });
    return null;
  }
  const mimeType = inferAttachmentMime(file.filename, '');
  return {
    name: file.filename,
    mimeType,
    type: attachmentType(mimeType),
    size: file.data.length,
    data: file.data.toString('base64'),
  };
}

interface RawAttachment {
  name?: string;
  mimeType?: string;
  type?: string;
  data?: string;
  uploadId?: string;
  size?: number;
}

function validateInboundAttachments(raw: unknown): InboundAttachment[] | { error: string } {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: 'attachments must be an array' };
  if (raw.length > MAX_ATTACHMENTS) return { error: 'too many attachments' };

  const validated: InboundAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { error: 'invalid attachment' };
    const att = item as RawAttachment;
    const name = typeof att.name === 'string' ? att.name.trim() : '';
    const mimeType = inferAttachmentMime(name, typeof att.mimeType === 'string' ? att.mimeType : '');
    const uploadId = typeof att.uploadId === 'string' ? att.uploadId.trim() : '';
    const data = typeof att.data === 'string' ? att.data : '';

    if (!name) return { error: 'invalid attachment fields' };

    if (uploadId) {
      const size = typeof att.size === 'number' && Number.isFinite(att.size) ? att.size : 0;
      if (size <= 0) return { error: 'invalid attachment fields' };
      validated.push({
        kind: 'upload',
        uploadId,
        name,
        mimeType,
        type: attachmentType(mimeType),
        size,
      });
      continue;
    }

    if (!data) return { error: 'invalid attachment fields' };

    let decoded: Buffer;
    try {
      decoded = Buffer.from(data, 'base64');
    } catch {
      return { error: 'invalid attachment data' };
    }
    if (decoded.length === 0 || decoded.length > MAX_LEGACY_ATTACHMENT_BYTES) {
      return { error: 'attachment size out of range' };
    }

    validated.push({
      kind: 'inline',
      name,
      mimeType,
      type: attachmentType(mimeType),
      size: decoded.length,
      data,
    });
  }
  return validated;
}

function buildAgentFacingAttachment(
  messageId: string,
  meta: StoredAttachmentMeta,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: meta.name,
    type: meta.type === 'image' ? 'image' : 'file',
    mimeType: meta.mimeType,
    size: meta.size,
  };
  if (meta.size > MAX_AGENT_INLINE_BYTES) return base;
  const filePath = getMessageAttachmentPath(messageId, meta.storageName);
  if (!filePath) return base;
  try {
    const inlineData = fs.readFileSync(filePath).toString('base64');
    return { ...base, data: inlineData };
  } catch {
    return base;
  }
}

function stagedUploadMatches(staged: StagedUpload, platformId: string, threadId: string): boolean {
  return staged.platformId === platformId && staged.threadId === threadId;
}

function persistStoredAttachments(
  msg: WebchatStoredMessage,
  storedAttachments: StoredAttachmentMeta[],
): WebchatStoredMessage {
  if (storedAttachments.length === 0) return appendMessage(msg);
  return appendMessageWithAttachmentMeta(msg, storedAttachments);
}

function staticMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function toStoredAttachments(attachments: WebChatAttachment[]): WebchatAttachmentInput[] {
  return attachments.map((a) => ({
    name: a.name,
    mimeType: a.mimeType,
    type: a.type,
    size: a.size,
    data: a.data,
  }));
}

function engagedAgentsChanged(before: string[], after: string[]): boolean {
  if (before.length !== after.length) return true;
  const beforeSet = new Set(before);
  return after.some((folder) => !beforeSet.has(folder));
}

async function dispatchInbound(platformId: string, threadId: string | null, inbound: InboundMessage): Promise<void> {
  try {
    await routeInbound({
      channelType: CHANNEL_TYPE,
      instance: CHANNEL_TYPE,
      platformId,
      threadId,
      message: {
        id: inbound.id,
        kind: inbound.kind,
        content: JSON.stringify(inbound.content),
        timestamp: inbound.timestamp,
        isMention: inbound.isMention,
        isGroup: inbound.isGroup,
      },
    });
  } catch (err) {
    log.error('Web inbound routing failed', { err, platformId, threadId, messageId: inbound.id });
  }
}

function lobbyAgentFolders(): { folders: string[]; teamFolder: string | null; agents: AgentNameRef[] } {
  const agents = getAllAgentGroups().map((a) => ({
    folder: a.folder,
    displayName: a.name,
  }));
  return {
    folders: agents.map((a) => a.folder),
    teamFolder: readTeamFolder(),
    agents,
  };
}

const agentDeliveryChains = new Map<string, Promise<void>>();
const pendingJoinStubByThread = new Map<string, string>();

function deliveryChainKey(platformId: string, threadId: string, folder: string): string {
  return `${platformId}|${threadId}|${folder}`;
}

function enqueueAgentDelivery(key: string, work: () => void | Promise<void>): Promise<void> {
  const prev = agentDeliveryChains.get(key) ?? Promise.resolve();
  const next = prev
    .then(() => Promise.resolve(work()))
    .catch((err) => {
      log.error('Web agent delivery chain failed', { err, key });
      return Promise.resolve(work());
    })
    .finally(() => {
      if (agentDeliveryChains.get(key) === next) {
        agentDeliveryChains.delete(key);
      }
    });
  agentDeliveryChains.set(key, next);
  return next;
}

/** Test helper: wait for all per-agent lobby delivery chains to finish. */
export async function flushWebAgentDeliveryChains(): Promise<void> {
  await Promise.all([...agentDeliveryChains.values()]);
}

/** Test helper: reset module-level delivery/join state between adapter instances. */
export function clearWebAdapterTestState(): void {
  agentDeliveryChains.clear();
  pendingJoinStubByThread.clear();
}

function agentRefsForFolders(folders: readonly string[], allAgents: readonly AgentNameRef[]): AgentNameRef[] {
  return folders.map((folder) => {
    const found = allAgents.find((a) => a.folder === folder);
    return found ?? { folder, displayName: folder };
  });
}

function threadTitle(platformId: string, threadId: string): string {
  return listThreads(platformId).find((t) => t.id === threadId)?.title ?? threadId;
}

function syntheticLobbyContent(
  text: string,
  receiverFolder: string,
  engagedAfter: readonly string[],
  syntheticKind: string,
  webUserId: string,
): Record<string, unknown> {
  return {
    text,
    sender: 'System',
    senderId: webUserId,
    [SYNTHETIC_MESSAGE_FIELD]: true,
    [SYNTHETIC_KIND_FIELD]: syntheticKind,
    [WEBCHAT_RECEIVER_FIELD]: receiverFolder,
    routing: buildRoutingMetadata(receiverFolder, [], [], engagedAfter, false),
  };
}

function inboundAttachmentsFromStored(attachments?: WebchatAttachmentInput[]): WebChatAttachment[] {
  return (
    attachments?.map((att) => ({
      name: att.name,
      mimeType: att.mimeType,
      type: att.type,
      size: att.size,
      ...(att.data ? { data: att.data } : {}),
    })) ?? []
  );
}

async function dispatchHistoryReplay(
  platformId: string,
  threadId: string | null,
  receiverFolder: string,
  webUserId: string,
  userDisplayName: string,
  allAgents: readonly AgentNameRef[],
  engagedAfter: readonly string[],
  history: readonly WebchatStoredMessage[],
): Promise<void> {
  const { folders, teamFolder } = lobbyAgentFolders();
  const mentionOpts = { agentFolders: folders, teamFolder };
  const engagedRefs: ImplicitMentionAgent[] = agentRefsForFolders(engagedAfter, allAgents);

  for (const msg of history) {
    const isOutbound = msg.direction === 'outbound';
    const explicitMentions = isOutbound ? [] : mentionedAgentFolders(msg.text, mentionOpts);
    const implicitMentions = isOutbound ? [] : implicitMentionedFolders(msg.text, engagedRefs);
    const senderFolder = isOutbound ? folderFromSenderName(msg.senderName, allAgents) : null;
    const attachments = inboundAttachmentsFromStored(msg.attachments);
    const routing = buildRoutingMetadata(receiverFolder, explicitMentions, implicitMentions, engagedAfter, isOutbound);
    const replayInbound: InboundMessage = {
      id: `web-backfill-replay-${msg.id}-${receiverFolder}`,
      kind: 'chat',
      content: {
        text: msg.text,
        sender: isOutbound ? msg.senderName?.trim() || 'Agent' : userDisplayName,
        senderId: webUserId,
        ...(msg.threadSeq != null ? { [THREAD_MESSAGE_SEQ_FIELD]: msg.threadSeq } : {}),
        [HISTORICAL_REPLAY_FIELD]: true,
        ...(isOutbound && senderFolder ? { senderFolder } : {}),
        [WEBCHAT_RECEIVER_FIELD]: receiverFolder,
        routing,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      timestamp: new Date(msg.timestamp).toISOString(),
      isGroup: true,
    };
    await dispatchInbound(platformId, threadId, replayInbound);
  }
}

function dispatchBackfillForAgent(
  platformId: string,
  threadId: string | null,
  threadIdStored: string,
  receiverFolder: string,
  webUserId: string,
  userDisplayName: string,
  allAgents: readonly AgentNameRef[],
  engagedAfter: readonly string[],
  excludeMessageId: string,
): Promise<void> {
  const chainKey = deliveryChainKey(platformId, threadIdStored, receiverFolder);
  return enqueueAgentDelivery(chainKey, async () => {
    if (hasBackfillDelivered(platformId, threadIdStored, receiverFolder)) {
      log.debug('Web backfill skipped — already delivered for agent', {
        platformId,
        threadId: threadIdStored,
        receiverFolder,
      });
      return;
    }

    const others = agentRefsForFolders(
      engagedAfter.filter((f) => f !== receiverFolder),
      allAgents,
    );
    const limit = readBackfillMessageLimit();
    const history = enrichMessagesWithAttachmentData(
      getRecentMessages(platformId, threadIdStored, limit).filter((m) => m.id !== excludeMessageId),
    );
    const stubInbound: InboundMessage = {
      id: `web-backfill-stub-${platformId}-${threadIdStored}-${receiverFolder}`,
      kind: 'chat',
      content: syntheticLobbyContent(roomContextStub(others), receiverFolder, engagedAfter, 'room_context', webUserId),
      timestamp: new Date().toISOString(),
      isGroup: true,
    };
    await dispatchInbound(platformId, threadId, stubInbound);

    if (history.length > 0) {
      const introInbound: InboundMessage = {
        id: `web-backfill-intro-${platformId}-${threadIdStored}-${receiverFolder}`,
        kind: 'chat',
        content: syntheticLobbyContent(
          backfillIntroLine(threadTitle(platformId, threadIdStored), others),
          receiverFolder,
          engagedAfter,
          'backfill_intro',
          webUserId,
        ),
        timestamp: new Date().toISOString(),
        isGroup: true,
      };
      await dispatchInbound(platformId, threadId, introInbound);
      await dispatchHistoryReplay(
        platformId,
        threadId,
        receiverFolder,
        webUserId,
        userDisplayName,
        allAgents,
        engagedAfter,
        history,
      );
    }

    markBackfillDelivered(platformId, threadIdStored, receiverFolder);
  });
}

function routeLobbyInbound(
  platformId: string,
  threadId: string | null,
  threadIdStored: string,
  baseInbound: InboundMessage,
  content: Record<string, unknown>,
  trimmedText: string,
  webUserId: string,
  userDisplayName: string,
  broadcastEngaged: (agents: string[]) => void,
): void {
  const { folders, teamFolder, agents } = lobbyAgentFolders();
  const mentionOpts = { agentFolders: folders, teamFolder };
  const explicitMentions = mentionedAgentFolders(trimmedText, mentionOpts);
  const priorEngaged = getEngagedAgents(platformId, threadIdStored);

  let engagedAfter = priorEngaged;
  if (explicitMentions.length > 0) {
    engagedAfter = addEngagedAgents(platformId, threadIdStored, explicitMentions);
    if (engagedAgentsChanged(priorEngaged, engagedAfter)) {
      broadcastEngaged(engagedAfter);
    }
  }

  if (engagedAfter.length === 0) return;

  const newlyEngaged = explicitMentions.filter((folder) => !priorEngaged.includes(folder));
  if (newlyEngaged.length > 0) {
    const joinedNames = newlyEngaged.map((folder) => {
      const ref = agents.find((a) => a.folder === folder);
      return ref?.displayName ?? folder;
    });
    pendingJoinStubByThread.set(
      `${platformId}|${threadIdStored}`,
      joinedNames.map((name) => rosterJoinStub(name)).join('\n'),
    );
  }

  const engagedRefs: ImplicitMentionAgent[] = agentRefsForFolders(engagedAfter, agents);
  const implicitMentions = implicitMentionedFolders(trimmedText, engagedRefs);
  const threadStubKey = `${platformId}|${threadIdStored}`;
  const joinStub = pendingJoinStubByThread.get(threadStubKey);

  for (const receiverFolder of engagedAfter) {
    if (newlyEngaged.includes(receiverFolder)) {
      dispatchBackfillForAgent(
        platformId,
        threadId,
        threadIdStored,
        receiverFolder,
        webUserId,
        userDisplayName,
        agents,
        engagedAfter,
        baseInbound.id,
      );
    }

    const chainKey = deliveryChainKey(platformId, threadIdStored, receiverFolder);
    enqueueAgentDelivery(chainKey, async () => {
      const routing = buildRoutingMetadata(receiverFolder, explicitMentions, implicitMentions, engagedAfter, false);
      let deliveryText = trimmedText;
      const routingContent: Record<string, unknown> = {
        ...content,
        text: deliveryText,
        [WEBCHAT_RECEIVER_FIELD]: receiverFolder,
        routing,
      };
      if (joinStub && !newlyEngaged.includes(receiverFolder)) {
        routingContent[ROSTER_STUB_FIELD] = joinStub;
      }
      const routingInbound: InboundMessage = {
        ...baseInbound,
        id: `${baseInbound.id}-route-${receiverFolder}`,
        content: routingContent,
      };
      await dispatchInbound(platformId, threadId, routingInbound);
    });
  }

  if (joinStub) {
    pendingJoinStubByThread.delete(threadStubKey);
  }
}

async function fanOutPeerReply(
  platformId: string,
  threadId: string | null,
  threadIdStored: string,
  webUserId: string,
  outboundText: string,
  outboundContent: unknown,
  threadMessageSeq?: number,
): Promise<void> {
  const { agents } = lobbyAgentFolders();
  const engaged = getEngagedAgents(platformId, threadIdStored);
  const senderName = extractSenderName(outboundContent);
  const senderFolder = extractSenderFolder(outboundContent) ?? folderFromSenderName(senderName, agents);
  const peers = senderFolder ? engaged.filter((folder) => folder !== senderFolder) : [];
  if (!senderFolder || peers.length === 0) {
    if (peers.length === 0 && senderFolder && engaged.length > 0) {
      log.debug('Web peer fan-out skipped — no peer recipients', {
        platformId,
        threadIdStored,
        senderFolder,
        engaged,
      });
    }
    if (!senderFolder) {
      log.warn('Web peer fan-out skipped — could not resolve sender folder', {
        platformId,
        threadIdStored,
        senderName,
      });
    }
    return;
  }

  for (const peerFolder of peers) {
    const routing = buildRoutingMetadata(peerFolder, [], [], engaged, true);
    const peerInbound: InboundMessage = {
      id: `web-peer-${Date.now()}-${peerFolder}-${Math.random().toString(36).slice(2, 6)}`,
      kind: 'chat',
      content: {
        text: outboundText,
        sender: senderName ?? senderFolder,
        senderId: webUserId,
        ...(senderName ? { senderName } : {}),
        senderFolder,
        ...(threadMessageSeq != null ? { [THREAD_MESSAGE_SEQ_FIELD]: threadMessageSeq } : {}),
        [WEBCHAT_RECEIVER_FIELD]: peerFolder,
        routing,
      },
      timestamp: new Date().toISOString(),
      isGroup: true,
    };
    const chainKey = deliveryChainKey(platformId, threadIdStored, peerFolder);
    await enqueueAgentDelivery(chainKey, () => dispatchInbound(platformId, threadId, peerInbound));
  }
}

const MAX_BODY_BYTES = 20 * 1024 * 1024;

export function createWebAdapter(opts: WebAdapterOptions): ChannelAdapter {
  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let setupConfig: ChannelSetup | null = null;
  let assetDir: string | null = null;
  let cachedIndexHtml: string | null = null;
  const wsClients = new Set<TrackedWsClient>();

  function isPublicMode(): boolean {
    return opts.authMode === 'public' && opts.publicAuth != null;
  }

  function resolveRequestUser(req: http.IncomingMessage): { userId: string; displayName: string } {
    if (isPublicMode()) {
      const session = resolveSessionUser(opts.publicAuth!, req);
      if (session) return session;
    }
    return { userId: opts.userId, displayName: opts.displayName };
  }

  function resolveStoragePlatformId(logicalPlatformId: string, sessionUserId: string): string {
    if (!isPublicMode()) return logicalPlatformId;
    return assertRoomAccess(logicalPlatformId, sessionUserId);
  }

  function tryResolveStoragePlatformId(
    logicalPlatformId: string,
    sessionUserId: string,
    res: http.ServerResponse,
  ): string | undefined {
    try {
      return resolveStoragePlatformId(logicalPlatformId, sessionUserId);
    } catch (e) {
      if (e instanceof RoomAccessError) {
        json(res, 403, { error: 'Forbidden' });
        return undefined;
      }
      throw e;
    }
  }

  function checkAuth(req: http.IncomingMessage, url: URL): boolean {
    const header = req.headers.authorization;
    if (header === `Bearer ${opts.authToken}`) return true;
    // Browser img/fetch cannot set Authorization; ?token= is accepted for /api/ws and
    // /api/attachments (weaker — may appear in logs/history/referrer).
    if (url.pathname === '/api/ws' || url.pathname.startsWith('/api/attachments/')) {
      const q = url.searchParams.get('token');
      if (q === opts.authToken) return true;
    }

    if (isPublicMode()) {
      if (isPublicAuthPath(url.pathname) && isPublicAuthExemptPath(url.pathname)) return true;
      return resolveSessionUser(opts.publicAuth!, req) != null;
    }

    return false;
  }

  function broadcast(event: unknown): void {
    const payload = JSON.stringify(event);
    for (const client of wsClients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (isPublicMode() && client.userId) {
        if (
          !shouldDeliverWsEvent(
            event as {
              type: string;
              platformId?: string;
              forUserId?: string;
              message?: { platformId?: string };
            },
            client.userId,
          )
        ) {
          continue;
        }
      }
      client.ws.send(payload);
    }
  }

  function messageForClient(msg: WebchatStoredMessage): WebchatStoredMessage {
    if (!isPublicMode()) return msg;
    return { ...msg, platformId: toLogicalPlatformId(msg.platformId) };
  }

  function wsEventForClient(
    event: Record<string, unknown>,
    storagePlatformId?: string,
  ): Record<string, unknown> {
    if (!isPublicMode()) return event;
    const owner = storagePlatformId ? ownerUserIdFromPhysical(storagePlatformId) : null;
    if (owner) return { ...event, forUserId: owner };
    return event;
  }

  function persistAndBroadcast(
    msg: WebchatStoredMessage,
    storedAttachments?: StoredAttachmentMeta[],
  ): WebchatStoredMessage {
    const stored =
      storedAttachments !== undefined
        ? persistStoredAttachments(msg, storedAttachments)
        : appendMessage(msg);
    const clientMsg = messageForClient(stored);
    broadcast(wsEventForClient({ type: 'message', message: clientMsg }, stored.platformId));
    return stored;
  }

  function broadcastMessageUpdate(message: WebchatStoredMessage): void {
    broadcast(
      wsEventForClient({ type: 'message_update', message: messageForClient(message) }, message.platformId),
    );
  }

  function readBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
    return new Promise((resolve, reject) => {
      const contentLength = req.headers['content-length'];
      if (contentLength && Number(contentLength) > maxBytes) {
        reject(new Error('body too large'));
        return;
      }
      let body = '';
      let bytes = 0;
      req.on('data', (chunk: Buffer | string) => {
        const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        bytes += size;
        if (bytes > maxBytes) {
          req.destroy();
          reject(new Error('body too large'));
          return;
        }
        body += chunk;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  function json(res: http.ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  function escapeHtmlAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function injectWebchatTokenMeta(html: string, token: string): string {
    const metaName = 'webchat-token';
    const meta = `<meta name="${metaName}" content="${escapeHtmlAttr(token)}" />`;
    const existing = new RegExp(`<meta name="${metaName}" content="[^"]*"\\s*/?>`);
    if (existing.test(html)) return html.replace(existing, meta);
    if (html.includes('</head>')) return html.replace('</head>', `    ${meta}\n  </head>`);
    return html;
  }

  // serveIndexHtml/isUnderAssetDir are only called from serveStatic after setup()
  // assigns assetDir and serveStatic's falsy assetDir guard returns early.
  function serveIndexHtml(res: http.ServerResponse): boolean {
    const indexPath = path.join(assetDir!, 'index.html');
    if (!fs.existsSync(indexPath)) return false;
    if (!cachedIndexHtml) {
      let html = fs.readFileSync(indexPath, 'utf8');
      if (!isPublicMode()) {
        html = injectWebchatTokenMeta(html, opts.authToken);
      }
      cachedIndexHtml = html;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(cachedIndexHtml);
    return true;
  }

  function isUnderAssetDir(filePath: string): boolean {
    const root = path.resolve(assetDir!);
    const resolved = path.resolve(filePath);
    return resolved === root || resolved.startsWith(root + path.sep);
  }

  function serveStatic(urlPath: string, res: http.ServerResponse): boolean {
    if (!assetDir) return false;
    const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const relative = safe === '/' ? 'index.html' : safe.replace(/^\/+/, '');
    if (relative === 'index.html') {
      return serveIndexHtml(res);
    }
    const filePath = path.join(assetDir, relative);
    if (!isUnderAssetDir(filePath)) {
      res.writeHead(403).end();
      return true;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return serveIndexHtml(res);
    }
    res.writeHead(200, { 'Content-Type': staticMimeType(filePath) });
    res.end(fs.readFileSync(filePath));
    return true;
  }

  async function handlePostMessage(
    logicalPlatformId: string,
    storagePlatformId: string,
    threadIdRaw: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    sender: { userId: string; displayName: string },
  ): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: 'read failed' });
      return;
    }
    let text: string;
    let attachmentsRaw: unknown;
    try {
      const parsed = JSON.parse(body) as { text?: string; attachments?: unknown };
      text = parsed.text ?? '';
      attachmentsRaw = parsed.attachments;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    const attachmentResult = validateInboundAttachments(attachmentsRaw);
    if (!Array.isArray(attachmentResult)) {
      json(res, 400, { error: attachmentResult.error });
      return;
    }
    const attachments = attachmentResult;

    if (!text.trim() && attachments.length === 0) {
      json(res, 400, { error: 'text or attachments required' });
      return;
    }

    const threadId = threadIdRaw === MAIN_THREAD ? null : threadIdRaw;
    const id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = new Date().toISOString();
    const isGroup = logicalPlatformId === WEB_LOBBY_PLATFORM_ID;

    const storedAttachments: StoredAttachmentMeta[] = [];
    let attachmentIndex = 0;

    for (const att of attachments) {
      if (att.kind !== 'upload') continue;
      const staged = getStagedUpload(att.uploadId);
      if (!staged || !stagedUploadMatches(staged, storagePlatformId, threadIdRaw)) {
        json(res, 400, { error: 'invalid upload reference' });
        return;
      }
      if (staged.size !== att.size || staged.name !== att.name) {
        json(res, 400, { error: 'invalid upload reference' });
        return;
      }
    }

    const consumedUploads: StagedUpload[] = [];
    for (const att of attachments) {
      if (att.kind !== 'upload') continue;
      const staged = consumeStagedUpload(att.uploadId);
      if (!staged) {
        for (const pending of consumedUploads) restoreStagedUpload(pending);
        json(res, 400, { error: 'invalid upload reference' });
        return;
      }
      consumedUploads.push(staged);
    }

    let uploadCursor = 0;
    let movedCount = 0;
    try {
      for (const att of attachments) {
        if (att.kind === 'upload') {
          const staged = consumedUploads[uploadCursor++]!;
          storedAttachments.push(
            moveAttachmentIntoMessage(id, attachmentIndex++, {
              name: staged.name,
              mimeType: staged.mimeType,
              type: staged.type,
              size: staged.size,
              sourcePath: staged.filePath,
            }),
          );
          movedCount++;
          try {
            fs.rmSync(path.dirname(staged.filePath), { recursive: true, force: true });
          } catch {
            // ignore staging dir cleanup
          }
          continue;
        }

        const inlineStored = writeAttachmentFiles(
          id,
          [
            {
              name: att.name,
              mimeType: att.mimeType,
              type: att.type,
              size: att.size,
              data: att.data,
            },
          ],
          attachmentIndex,
        );
        storedAttachments.push(...inlineStored);
        attachmentIndex += inlineStored.length;
      }
    } catch {
      deleteMessageFiles(id);
      // Renamed uploads (indices 0..movedCount-1) are gone; restore only not-yet-moved staging refs.
      for (let i = movedCount; i < consumedUploads.length; i++) {
        restoreStagedUpload(consumedUploads[i]!);
      }
      json(res, 500, { error: 'attachment processing failed' });
      return;
    }

    const content: Record<string, unknown> = {
      text: text.trim(),
      sender: sender.displayName,
      senderId: sender.userId,
    };
    if (storedAttachments.length > 0) {
      content.attachments = storedAttachments.map((meta) => buildAgentFacingAttachment(id, meta));
    }

    const inbound: InboundMessage = {
      id,
      kind: 'chat',
      content,
      timestamp,
      isGroup,
    };

    const stored = persistAndBroadcast(
      {
        id,
        direction: 'inbound',
        text: text.trim(),
        timestamp: Date.now(),
        platformId: storagePlatformId,
        threadId: threadId ?? MAIN_THREAD,
        senderName: sender.displayName,
        senderId: sender.userId,
      },
      storedAttachments.length > 0 ? storedAttachments : undefined,
    );
    content[THREAD_MESSAGE_SEQ_FIELD] = stored.threadSeq;
    inbound.content = content;

    if (setupConfig) {
      const threadIdStored = threadId ?? MAIN_THREAD;
      const trimmedText = text.trim();
      if (isGroup) {
        routeLobbyInbound(
          storagePlatformId,
          threadId,
          threadIdStored,
          inbound,
          content,
          trimmedText,
          sender.userId,
          sender.displayName,
          (agents) => {
            broadcast(
              wsEventForClient(
                {
                  type: 'engaged',
                  platformId: toLogicalPlatformId(storagePlatformId),
                  threadId: threadIdStored,
                  agents,
                },
                storagePlatformId,
              ),
            );
          },
        );
      } else {
        void dispatchInbound(storagePlatformId, threadId, inbound);
      }
    }

    json(res, 200, {
      messageId: id,
      timestamp: stored.timestamp,
      ...(stored.attachments?.length ? { attachments: stored.attachments } : {}),
    });
  }

  async function handleMultipartUpload(
    platformId: string,
    threadId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const result = await parseMultipartUpload(req, platformId, threadId);
    if ('error' in result) {
      json(res, result.status, { error: result.error });
      return;
    }
    const { upload } = result;
    json(res, 200, {
      uploadId: upload.uploadId,
      name: upload.name,
      mimeType: upload.mimeType,
      type: upload.type,
      size: upload.size,
    });
  }

  async function handleChunkUpload(
    platformId: string,
    threadId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let body: string;
    try {
      body = await readBody(req, CHUNK_SIZE * 2);
    } catch {
      json(res, 413, { error: 'chunk body too large' });
      return;
    }
    let parsed: {
      uploadId?: string;
      chunkIndex?: number;
      totalChunks?: number;
      filename?: string;
      mimeType?: string;
      data?: string;
    };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }
    if (
      typeof parsed.uploadId !== 'string' ||
      typeof parsed.filename !== 'string' ||
      typeof parsed.data !== 'string' ||
      typeof parsed.chunkIndex !== 'number' ||
      typeof parsed.totalChunks !== 'number'
    ) {
      json(res, 400, { error: 'Missing or invalid required fields' });
      return;
    }
    const result = await acceptChunk(
      {
        uploadId: parsed.uploadId,
        chunkIndex: parsed.chunkIndex,
        totalChunks: parsed.totalChunks,
        filename: parsed.filename,
        mimeType: parsed.mimeType,
        data: parsed.data,
      },
      platformId,
      threadId,
    );
    if (!result.ok) {
      json(res, result.status, { error: result.error });
      return;
    }
    if (result.upload) {
      json(res, 200, {
        uploadId: result.upload.uploadId,
        name: result.upload.name,
        mimeType: result.upload.mimeType,
        type: result.upload.type,
        size: result.upload.size,
        received: result.received,
        total: result.total,
      });
      return;
    }
    json(res, 200, { ok: true, received: result.received, total: result.total });
  }

  async function handlePostAction(
    platformId: string,
    threadIdRaw: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: 'read failed' });
      return;
    }

    let questionId: string;
    let value: string;
    try {
      const parsed = JSON.parse(body) as { questionId?: string; value?: string };
      questionId = typeof parsed.questionId === 'string' ? parsed.questionId.trim() : '';
      value = typeof parsed.value === 'string' ? parsed.value : '';
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }

    if (!questionId || !value) {
      json(res, 400, { error: 'questionId and value required' });
      return;
    }

    const message = findMessageByQuestionId(platformId, threadIdRaw, questionId);
    if (!message?.card) {
      json(res, 404, { error: 'card not found' });
      return;
    }

    if (message.card.status === 'answered') {
      json(res, 409, { error: 'card already answered' });
      return;
    }

    const selectedOption = message.card.options.find((opt) => opt.value === value);
    if (!selectedOption) {
      json(res, 400, { error: 'invalid option value' });
      return;
    }

    const selectedLabel = selectedOption.selectedLabel ?? selectedOption.label;
    const result = answerCardsByQuestionId(questionId, value, selectedLabel);
    if (!result.ok) {
      if (result.reason === 'already_answered') {
        json(res, 409, { error: 'card already answered' });
        return;
      }
      json(res, 404, { error: 'card not found' });
      return;
    }

    try {
      await Promise.resolve(setupConfig?.onAction(questionId, value, opts.userId));
    } catch (err) {
      revertCardsByQuestionId(questionId);
      log.error('Approval action handler failed', { questionId, err });
      json(res, 500, { error: 'action failed' });
      return;
    }

    for (const updated of result.messages) {
      broadcastMessageUpdate(updated);
    }

    json(res, 200, { ok: true });
  }

  async function handleCreateThread(
    platformId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let title = 'Thread';
    try {
      const body = await readBody(req);
      if (body.trim()) {
        const parsed = JSON.parse(body) as { title?: string };
        if (typeof parsed.title === 'string' && parsed.title.trim()) {
          title = parsed.title.trim();
        }
      }
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }
    const thread = createThread(platformId, title);
    json(res, 200, thread);
  }

  async function handlePatchThread(
    platformId: string,
    threadId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    let body: string;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: 'read failed' });
      return;
    }
    let title: string;
    try {
      const parsed = JSON.parse(body) as { title?: string };
      title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }
    if (!title) {
      json(res, 400, { error: 'title required' });
      return;
    }
    upsertThread(platformId, threadId, title);
    json(res, 200, { id: threadId, title });
  }

  function handleDeleteThread(platformId: string, threadId: string, res: http.ServerResponse): void {
    if (threadId === MAIN_THREAD) {
      json(res, 400, { error: 'cannot delete main thread' });
      return;
    }
    deleteThreadData(platformId, threadId);
    try {
      const mg = getMessagingGroupByPlatform(CHANNEL_TYPE, platformId);
      if (mg) {
        cleanupAgentSessionsForThread(mg.id, threadId);
      }
    } catch (err) {
      log.error('Web thread session cleanup failed', { err, platformId, threadId });
    }
    json(res, 200, { ok: true });
  }

  function serveAttachment(messageId: string, storageName: string, req: http.IncomingMessage, res: http.ServerResponse): void {
    const filePath = getMessageAttachmentPath(messageId, storageName);
    if (!filePath) {
      res.writeHead(404).end();
      return;
    }
    serveAttachmentFile(filePath, storageName, req, res);
  }

  return {
    name: 'web',
    channelType: CHANNEL_TYPE,
    supportsThreads: true,

    async setup(config: ChannelSetup): Promise<void> {
      setupConfig = config;
      ensureWebchatSchema();
      if (isPublicMode()) ensureWebchatAuthSchema();

      try {
        const pkg = await import('nanoclaw-webchat');
        // Must be set before the HTTP server accepts requests; setup() throws if missing.
        // serveStatic guards falsy assetDir; serveIndexHtml/isUnderAssetDir rely on this.
        assetDir = pkg.getAssetDir();
      } catch (err) {
        log.error('Web channel: nanoclaw-webchat not installed', { err });
        throw err;
      }

      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port}`);

          if (url.pathname === '/api/ws') {
            res.writeHead(426).end();
            return;
          }

          if (url.pathname.startsWith('/api/')) {
            if (isPublicMode() && isPublicAuthPath(url.pathname)) {
              const handled = await handlePublicAuthRequest(
                req,
                res,
                url,
                opts.publicAuth!,
                json,
                (user) => ensureUserWebchatWirings(user.userId, user.displayName),
              );
              if (handled) return;
            }

            if (!checkAuth(req, url)) {
              json(res, 401, { error: 'Unauthorized' });
              return;
            }

            const requestUser = resolveRequestUser(req);

            if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
              json(res, 200, {
                ...buildWebchatBootstrap(requestUser.userId, requestUser.displayName),
                authMode: opts.authMode,
              });
              return;
            }

            const attMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/([^/]+)$/);
            if (attMatch && req.method === 'GET') {
              const messageId = decodeURIComponent(attMatch[1]!);
              const storageName = decodeURIComponent(attMatch[2]!);
              serveAttachment(messageId, storageName, req, res);
              return;
            }

            const threadsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads$/);
            if (threadsMatch && req.method === 'POST') {
              const logicalPlatformId = decodeURIComponent(threadsMatch[1]!);
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              await handleCreateThread(storagePlatformId, req, res);
              return;
            }

            const threadMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads\/([^/]+)$/);
            if (threadMatch) {
              const logicalPlatformId = decodeURIComponent(threadMatch[1]!);
              const threadId = decodeURIComponent(threadMatch[2]!);
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              if (req.method === 'PATCH') {
                await handlePatchThread(storagePlatformId, threadId, req, res);
                return;
              }
              if (req.method === 'DELETE') {
                handleDeleteThread(storagePlatformId, threadId, res);
                return;
              }
            }

            const msgMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/messages$/);
            if (msgMatch) {
              const logicalPlatformId = decodeURIComponent(msgMatch[1]!);
              const threadId = decodeURIComponent(msgMatch[2]!);
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              if (req.method === 'GET') {
                const since = parseInt(url.searchParams.get('since') ?? '0', 10);
                const messages = getMessages(storagePlatformId, threadId, since).map(messageForClient);
                const engagedAgents =
                  logicalPlatformId === WEB_LOBBY_PLATFORM_ID
                    ? getEngagedAgents(storagePlatformId, threadId)
                    : [];
                json(res, 200, { messages, engagedAgents });
                return;
              }
              if (req.method === 'POST') {
                await handlePostMessage(
                  logicalPlatformId,
                  storagePlatformId,
                  threadId,
                  req,
                  res,
                  requestUser,
                );
                return;
              }
            }

            const uploadChunkMatch = url.pathname.match(
              /^\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/uploads\/chunk$/,
            );
            if (uploadChunkMatch && req.method === 'POST') {
              const logicalPlatformId = decodeURIComponent(uploadChunkMatch[1]!);
              const threadId = decodeURIComponent(uploadChunkMatch[2]!);
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              await handleChunkUpload(storagePlatformId, threadId, req, res);
              return;
            }

            const uploadMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/uploads$/);
            if (uploadMatch && req.method === 'POST') {
              const logicalPlatformId = decodeURIComponent(uploadMatch[1]!);
              const threadId = decodeURIComponent(uploadMatch[2]!);
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              await handleMultipartUpload(storagePlatformId, threadId, req, res);
              return;
            }

            const actionMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/actions$/);
            if (actionMatch && req.method === 'POST') {
              const logicalPlatformId = decodeURIComponent(actionMatch[1]!);
              const threadId = decodeURIComponent(actionMatch[2]!);
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              await handlePostAction(storagePlatformId, threadId, req, res);
              return;
            }

            const engagedMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/threads\/([^/]+)\/engaged\/([^/]+)$/);
            if (engagedMatch && req.method === 'DELETE') {
              const logicalPlatformId = decodeURIComponent(engagedMatch[1]!);
              const threadId = decodeURIComponent(engagedMatch[2]!);
              const agentFolder = decodeURIComponent(engagedMatch[3]!);
              if (logicalPlatformId !== WEB_LOBBY_PLATFORM_ID) {
                json(res, 400, { error: 'engaged agents only apply to lobby' });
                return;
              }
              const storagePlatformId = tryResolveStoragePlatformId(
                logicalPlatformId,
                requestUser.userId,
                res,
              );
              if (storagePlatformId === undefined) return;
              const agents = removeEngagedAgent(storagePlatformId, threadId, agentFolder);
              broadcast(
                wsEventForClient(
                  {
                    type: 'engaged',
                    platformId: toLogicalPlatformId(storagePlatformId),
                    threadId,
                    agents,
                  },
                  storagePlatformId,
                ),
              );
              json(res, 200, { agents });
              return;
            }

            json(res, 404, { error: 'Not found' });
            return;
          }

          if (req.method === 'GET') {
            if (serveStatic(url.pathname, res)) return;
          }

          res.writeHead(404).end();
        } catch (err) {
          log.error('Web channel request failed', { err, path: req.url });
          /* v8 ignore if -- streaming handlers may have already started the response */
          if (!res.headersSent) {
            json(res, 500, { error: 'Internal server error' });
          }
        }
      });

      wss = new WebSocketServer({ noServer: true });

      server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port}`);
        if (url.pathname !== '/api/ws') {
          socket.destroy();
          return;
        }
        if (!checkAuth(req, url)) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        wss!.handleUpgrade(req, socket, head, (ws) => {
          const sessionUser = isPublicMode() ? resolveSessionUser(opts.publicAuth!, req) : null;
          const client: TrackedWsClient = { ws, userId: sessionUser?.userId ?? null };
          wsClients.add(client);
          ws.on('close', () => wsClients.delete(client));
        });
      });

      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(opts.port, opts.bindAddress ?? '127.0.0.1', () => {
          log.info('Web channel listening', { port: opts.port, bindAddress: opts.bindAddress ?? '127.0.0.1' });
          resolve();
        });
      });

      config.onMetadata('lobby', 'Web Lobby', true);
    },

    async teardown(): Promise<void> {
      for (const client of wsClients) {
        try {
          client.ws.close();
        } catch {
          // swallow
        }
      }
      wsClients.clear();
      if (wss) {
        await new Promise<void>((resolve) => wss!.close(() => resolve()));
        wss = null;
      }
      if (server) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = null;
      }
      log.info('Web channel stopped');
    },

    isConnected(): boolean {
      return server?.listening ?? false;
    },

    async deliver(platformId: string, threadId: string | null, message: OutboundMessage): Promise<string | undefined> {
      const askQuestion = parseAskQuestionContent(message.content);
      if (askQuestion) {
        const card = buildAskQuestionCard(askQuestion);
        const text = cardFallbackText(card.title, card.question);
        const origin =
          platformId === WEB_INBOX_PLATFORM_ID ? resolveApprovalSessionOrigin(askQuestion.questionId) : undefined;
        const senderName = extractSenderName(message.content) ?? origin?.agentName;
        const id = `web-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        persistAndBroadcast({
          id,
          direction: 'outbound',
          text,
          timestamp: Date.now(),
          platformId,
          threadId: threadId ?? MAIN_THREAD,
          card,
          ...(senderName ? { senderName } : {}),
        });

        if (
          origin &&
          origin.platformId !== WEB_INBOX_PLATFORM_ID &&
          origin.platformId !== platformId
        ) {
          const mirrorId = `web-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          persistAndBroadcast({
            id: mirrorId,
            direction: 'outbound',
            text,
            timestamp: Date.now(),
            platformId: origin.platformId,
            threadId: origin.threadId,
            card,
            ...(senderName ? { senderName } : {}),
          });
        }

        return id;
      }

      const text = extractText(message.content);
      const attachments =
        message.files?.map(outboundFileToAttachment).filter((a): a is WebChatAttachment => a !== null) ?? [];
      if (!text.trim() && attachments.length === 0) return undefined;
      const id = `web-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const senderName = extractSenderName(message.content);
      const stored = persistAndBroadcast({
        id,
        direction: 'outbound',
        text,
        timestamp: Date.now(),
        platformId,
        threadId: threadId ?? MAIN_THREAD,
        ...(senderName ? { senderName } : {}),
        ...(attachments.length > 0 ? { attachments: toStoredAttachments(attachments) } : {}),
      });

      if (platformId === 'lobby' && text.trim()) {
        await fanOutPeerReply(
          platformId,
          threadId,
          threadId ?? MAIN_THREAD,
          opts.userId,
          text.trim(),
          message.content,
          stored.threadSeq,
        );
      }

      return id;
    },

    /** Host approval DMs land in the shared Inbox room (local) or per-user inbox (public). */
    async openDM(userHandle: string): Promise<string> {
      if (isPublicMode() && userHandle.startsWith('web:')) {
        return inboxPlatformForUser(userHandle);
      }
      return WEB_INBOX_PLATFORM_ID;
    },

    async setTyping(platformId: string, threadId: string | null): Promise<void> {
      broadcast({
        type: 'typing',
        platformId,
        threadId: threadId ?? MAIN_THREAD,
      });
    },
  };
}

/** Resolve listen port from process env and optional `.env` values (exported for tests). */
export function resolveWebchatPort(env: Record<string, string | undefined>): number {
  const portStr = process.env.WEBCHAT_PORT || env.WEBCHAT_PORT || '3200';
  return parseInt(portStr, 10);
}

registerChannelAdapter('web', {
  factory: () => {
    const cfg = loadWebAdapterAuthConfig();
    if (!cfg) return null;

    const env = readEnvFile(['WEBCHAT_PORT']);
    const port = resolveWebchatPort(env);

    return createWebAdapter({
      port,
      bindAddress: cfg.bindAddress,
      authMode: cfg.mode,
      authToken: cfg.authToken,
      userId: cfg.localUserId,
      displayName: cfg.localDisplayName,
      publicAuth: cfg.public,
    });
  },
});

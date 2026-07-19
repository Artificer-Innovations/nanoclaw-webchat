/**
 * Lobby engaged-agent routing: metadata, backfill formatting, receiver field.
 */
import { readEnvFile } from './env.js';

export type ResponseExpectation = 'expected' | 'lean' | 'defer';

export interface LobbyRoutingMetadata {
  explicitMentions: string[];
  implicitMentions: string[];
  engagedAgents: string[];
  responseExpectation: ResponseExpectation;
  isPeerReply: boolean;
}

export interface AgentNameRef {
  folder: string;
  displayName: string;
}

export interface WebchatParsedContent {
  [key: string]: unknown;
}

/** Content field: target agent folder for lobby engaged deliveries (router bypasses @ pattern). */
export const WEBCHAT_RECEIVER_FIELD = 'webchatReceiver';

/** Thread-scoped monotonic message id assigned at ingestion (same for all fan-out copies). */
export const THREAD_MESSAGE_SEQ_FIELD = 'threadMessageSeq';

/** Roster-change notice delivered separately from user message text. */
export const ROSTER_STUB_FIELD = 'rosterStub';

/** Host-only synthetic deliveries (join stubs, backfill intro) — not thread message IDs. */
export const SYNTHETIC_MESSAGE_FIELD = 'synthetic';

/** Kind label for synthetic deliveries (`room_context`, `backfill_intro`, …). */
export const SYNTHETIC_KIND_FIELD = 'syntheticKind';

/** Historical thread replay during backfill — context only, no wake. */
export const HISTORICAL_REPLAY_FIELD = 'historicalReplay';

const DEFAULT_BACKFILL_LIMIT = 20;

export function resolveWebchatReceiver(parsed: WebchatParsedContent): string | null {
  const receiver = parsed[WEBCHAT_RECEIVER_FIELD];
  if (typeof receiver !== 'string') return null;
  const trimmed = receiver.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isWebchatContextOnly(parsed: WebchatParsedContent): boolean {
  if (parsed[SYNTHETIC_MESSAGE_FIELD] === true) return true;
  if (parsed[HISTORICAL_REPLAY_FIELD] === true) return true;
  const routing = parsed.routing;
  return !!routing && typeof routing === 'object' && (routing as { isPeerReply?: unknown }).isPeerReply === true;
}

export function readBackfillMessageLimit(): number {
  const fromEnv = process.env.WEBCHAT_BACKFILL_MESSAGE_LIMIT;
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const file = readEnvFile(['WEBCHAT_BACKFILL_MESSAGE_LIMIT']);
  if (file.WEBCHAT_BACKFILL_MESSAGE_LIMIT) {
    const parsed = parseInt(file.WEBCHAT_BACKFILL_MESSAGE_LIMIT, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_BACKFILL_LIMIT;
}

export function computeResponseExpectation(
  receiverFolder: string,
  explicitMentions: readonly string[],
  implicitMentions: readonly string[],
  isPeerReply: boolean,
): ResponseExpectation {
  if (isPeerReply) return 'defer';
  if (explicitMentions.includes(receiverFolder)) return 'expected';
  if (implicitMentions.includes(receiverFolder)) return 'lean';
  return 'defer';
}

export function buildRoutingMetadata(
  receiverFolder: string,
  explicitMentions: readonly string[],
  implicitMentions: readonly string[],
  engagedAgents: readonly string[],
  isPeerReply: boolean,
): LobbyRoutingMetadata {
  return {
    explicitMentions: [...explicitMentions],
    implicitMentions: [...implicitMentions],
    engagedAgents: [...engagedAgents],
    responseExpectation: computeResponseExpectation(receiverFolder, explicitMentions, implicitMentions, isPeerReply),
    isPeerReply,
  };
}

export function backfillIntroLine(threadTitle: string, otherAgents: readonly AgentNameRef[]): string {
  const lines: string[] = [`[System] You've been added to lobby thread "${threadTitle}".`];
  if (otherAgents.length > 0) {
    lines.push(`Other agents listening: ${otherAgents.map((a) => a.displayName).join(', ')}.`);
  }
  lines.push('Recent thread messages follow as individual deliveries.');
  return lines.join('\n');
}

export function roomContextStub(otherAgents: readonly AgentNameRef[]): string {
  const roster =
    otherAgents.length > 0
      ? `Other agents currently listening: ${otherAgents.map((a) => a.displayName).join(', ')}.`
      : 'You are the only agent currently listening.';
  return `You are engaged in this lobby thread. ${roster} You receive the same user messages and other agents' replies in this thread.`;
}

export function rosterJoinStub(displayName: string): string {
  return `${displayName} has joined this thread.`;
}

export function folderFromSenderName(senderName: string | undefined, agents: readonly AgentNameRef[]): string | null {
  if (!senderName?.trim()) return null;
  const lower = senderName.trim().toLowerCase();
  for (const agent of agents) {
    if (agent.folder.toLowerCase() === lower) return agent.folder;
    if (agent.displayName.toLowerCase() === lower) return agent.folder;
  }
  return null;
}

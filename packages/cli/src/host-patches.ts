/**
 * Idempotent, reversible host patches that make NanoClaw consume webchat
 * lobby routing metadata (router) and stamp agent identity on web outbound
 * deliveries (delivery).
 */
import fs from 'node:fs';
import path from 'node:path';

export type HostPatchStatus = 'applied' | 'already' | 'already-equivalent' | 'removed' | 'absent';

export interface HostPatchResult {
  status: HostPatchStatus;
  path: string;
}

export const ROUTER_PATCH_MARKER = 'nanoclaw-webchat:lobby-routing';
export const DELIVERY_PATCH_MARKER = 'nanoclaw-webchat:sender-attribution';

/** Minimal stock-shaped router for CLI/fixture install tests (matches upstream anchors). */
export const STOCK_ROUTER_FIXTURE = `import type { InboundEvent } from './channels/adapter.js';
import type { AgentGroup, MessagingGroup, MessagingGroupAgent } from './types.js';

function safeParseContent(raw: string): { text?: string; sender?: string; senderId?: string } {
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
}

export async function routeInbound(event: InboundEvent): Promise<void> {
  const isMention = event.message.isMention === true;
  const agents: MessagingGroupAgent[] = [];
  const mg = { id: 'mg', is_group: 1 } as MessagingGroup;
  const userId: string | null = null;
  const accessGate = null;
  const senderScopeGate = null;

  const parsed = safeParseContent(event.message.content);
  const messageText = parsed.text ?? '';

  // Per-wiring thread policy inputs, resolved once per event.
  const channelDefaults = null;
  const supportsThreads = true;

  for (const agent of agents) {
    const agentGroup = { folder: 'agent' } as AgentGroup;
    const threadsEnabled = true;
    const effectiveThreadId = threadsEnabled ? event.threadId : null;

    const engages = evaluateEngage(agent, messageText, isMention, mg, effectiveThreadId);

    const accessOk = engages && (!accessGate || true);
    const scopeOk = engages && (!senderScopeGate || true);

    if (engages && accessOk && scopeOk) {
      await deliverToAgent(agent, agentGroup, mg, event, userId, threadsEnabled, effectiveThreadId, true);
    } else if (agent.ignored_message_policy === 'accumulate') {
      await deliverToAgent(agent, agentGroup, mg, event, userId, threadsEnabled, effectiveThreadId, false);
    }
  }
  void channelDefaults;
  void supportsThreads;
}

function evaluateEngage(
  _agent: MessagingGroupAgent,
  _text: string,
  _isMention: boolean,
  _mg: MessagingGroup,
  _threadId: string | null,
): boolean {
  return false;
}

async function deliverToAgent(
  agent: MessagingGroupAgent,
  agentGroup: AgentGroup,
  mg: MessagingGroup,
  event: InboundEvent,
  userId: string | null,
  threadsEnabled: boolean,
  effectiveThreadId: string | null,
  wake: boolean,
): Promise<void> {
  void agent;
  void agentGroup;
  void mg;
  void userId;
  void threadsEnabled;
  void effectiveThreadId;
  void wake;
  if (event.message.kind === 'chat' || event.message.kind === 'chat-sdk') {
    return;
  }
}

function gateCommand(_content: string, _userId: string | null, _agentGroupId: string): { action: string } {
  return { action: 'allow' };
}
void gateCommand;
`;

/** Minimal stock-shaped delivery module for CLI/fixture install tests. */
export const STOCK_DELIVERY_FIXTURE = `import { getAgentGroup } from './db/agent-groups.js';
import { readOutboxFiles } from './session-manager.js';
import type { Session } from './types.js';

const deliveryAdapter = {
  async deliver(
    _channelType: string,
    _platformId: string,
    _threadId: string | null,
    _kind: string,
    _content: string,
    _files?: unknown[],
    _instance?: string,
  ): Promise<string | undefined> {
    return undefined;
  },
};

export async function deliverMessage(
  msg: {
    id: string;
    kind: string;
    platform_id: string | null;
    channel_type: string | null;
    thread_id: string | null;
    content: string;
  },
  session: Session,
): Promise<string | undefined> {
  const content = JSON.parse(msg.content) as Record<string, unknown>;
  const deliverInstance = msg.channel_type ?? undefined;

  if (!msg.channel_type || !msg.platform_id) {
    return;
  }

  // Read file attachments from outbox if the content declares files.
  // File I/O lives in session-manager.ts (symmetric with inbound
  // extractAttachmentFiles) — delivery just hands buffers to the adapter.
  const files =
    Array.isArray(content.files) && content.files.length > 0
      ? readOutboxFiles(session.agent_group_id, session.id, msg.id, content.files as string[])
      : undefined;

  const platformMsgId = await deliveryAdapter.deliver(
    msg.channel_type,
    msg.platform_id,
    msg.thread_id,
    msg.kind,
    msg.content,
    files,
    deliverInstance,
  );
  return platformMsgId;
}

export function registerDeliveryAction(
  _action: string,
  _handler: (...args: unknown[]) => Promise<void>,
  _spec?: unknown,
): void {}

export function reenterGuardedDeliveryAction(_action: string): (ctx: unknown) => Promise<void> {
  return async () => undefined;
}

void getAgentGroup;
`;

const ROUTING_IMPORT =
  "import { isWebchatContextOnly, resolveWebchatReceiver, WEBCHAT_RECEIVER_FIELD } from './webchat-routing.js';";

const SAFE_PARSE_STOCK =
  'function safeParseContent(raw: string): { text?: string; sender?: string; senderId?: string } {';

const SAFE_PARSE_PATCHED = `function safeParseContent(raw: string): {
  text?: string;
  sender?: string;
  senderId?: string;
  [WEBCHAT_RECEIVER_FIELD]?: unknown;
  routing?: { isPeerReply?: unknown };
  synthetic?: unknown;
  historicalReplay?: unknown;
} {`;

const MESSAGE_TEXT_STOCK = `  const parsed = safeParseContent(event.message.content);
  const messageText = parsed.text ?? '';

  // Per-wiring thread policy inputs`;

const MESSAGE_TEXT_PATCHED = `  const parsed = safeParseContent(event.message.content);
  const messageText = parsed.text ?? '';
  // ${ROUTER_PATCH_MARKER}
  const webchatReceiver = resolveWebchatReceiver(parsed);
  const contextOnly = isWebchatContextOnly(parsed);

  // Per-wiring thread policy inputs`;

const ENGAGES_STOCK =
  '    const engages = evaluateEngage(agent, messageText, isMention, mg, effectiveThreadId);';

const ENGAGES_PATCHED = `    // ${ROUTER_PATCH_MARKER} — targeted fan-out bypasses engage_pattern
    const engages =
      webchatReceiver !== null
        ? agentGroup.folder === webchatReceiver
        : evaluateEngage(agent, messageText, isMention, mg, effectiveThreadId);`;

const DELIVER_WAKE_STOCK =
  '      await deliverToAgent(agent, agentGroup, mg, event, userId, threadsEnabled, effectiveThreadId, true);';

const DELIVER_WAKE_PATCHED = `      // ${ROUTER_PATCH_MARKER}
      const shouldWake = !contextOnly;
      const skipCommandGate = contextOnly;
      await deliverToAgent(
        agent,
        agentGroup,
        mg,
        event,
        userId,
        threadsEnabled,
        effectiveThreadId,
        shouldWake,
        skipCommandGate,
      );`;

const DELIVER_SIG_STOCK = `async function deliverToAgent(
  agent: MessagingGroupAgent,
  agentGroup: AgentGroup,
  mg: MessagingGroup,
  event: InboundEvent,
  userId: string | null,
  threadsEnabled: boolean,
  effectiveThreadId: string | null,
  wake: boolean,
): Promise<void> {`;

const DELIVER_SIG_PATCHED = `async function deliverToAgent(
  agent: MessagingGroupAgent,
  agentGroup: AgentGroup,
  mg: MessagingGroup,
  event: InboundEvent,
  userId: string | null,
  threadsEnabled: boolean,
  effectiveThreadId: string | null,
  wake: boolean,
  skipCommandGate = false,
): Promise<void> {`;

const COMMAND_GATE_STOCK =
  '  if (event.message.kind === \'chat\' || event.message.kind === \'chat-sdk\') {';

const COMMAND_GATE_PATCHED =
  '  if (!skipCommandGate && (event.message.kind === \'chat\' || event.message.kind === \'chat-sdk\')) {';

const DELIVERY_STAMP_BLOCK = `  // ${DELIVERY_PATCH_MARKER}
  // Webchat sender attribution: the web adapter and its peer fan-out resolve
  // the sending agent from \`senderName\`/\`senderFolder\` in the outbound content
  // (see channels/web.ts extractSenderName / fanOutPeerReply), but the
  // container's send_message writes bare \`{ text }\`. Without a stamp the UI
  // falls back to guessing attribution from @mention order (mislabeling
  // multi-agent lobby replies as the wrong agent or generic "Agent") and peer
  // fan-out cannot resolve the sender, so engaged agents never see each
  // other's replies. Stamp the identity here, where the session → agent group
  // mapping is known. Web-only: other channel adapters render content as-is.
  let deliveryContent = msg.content;
  if (msg.channel_type === 'web') {
    const hasSenderName = typeof content.senderName === 'string' && content.senderName.trim() !== '';
    if (!hasSenderName) {
      const agentGroup = getAgentGroup(session.agent_group_id);
      if (agentGroup) {
        deliveryContent = JSON.stringify({
          ...content,
          senderName: agentGroup.name,
          senderFolder: agentGroup.folder,
        });
      }
    }
  }

`;

/** True when host already has MyNanoClaw/PR-equivalent lobby routing (not necessarily our markers). */
export function hasEquivalentRouterLobbyRouting(content: string): boolean {
  const hasReceiverBypass =
    content.includes('resolveWebchatReceiver') ||
    (content.includes('webchatReceiver') && content.includes('agentGroup.folder === webchatReceiver'));
  const hasContextOnly =
    content.includes('isWebchatContextOnly') ||
    (content.includes('isPeerReply') && content.includes('isSynthetic') && content.includes('isHistoricalReplay'));
  const hasSkipGate = content.includes('skipCommandGate');
  return hasReceiverBypass && hasContextOnly && hasSkipGate;
}

export function hasManagedRouterLobbyRouting(content: string): boolean {
  return content.includes(ROUTER_PATCH_MARKER);
}

/** Apply lobby-routing transforms to router source. Pure — does not touch disk. */
export function applyRouterLobbyRoutingContent(content: string): { next: string; status: HostPatchStatus } {
  if (hasManagedRouterLobbyRouting(content)) {
    return { next: content, status: 'already' };
  }
  if (hasEquivalentRouterLobbyRouting(content)) {
    return { next: content, status: 'already-equivalent' };
  }

  const missing: string[] = [];
  if (!content.includes(SAFE_PARSE_STOCK)) missing.push('safeParseContent signature');
  if (!content.includes(MESSAGE_TEXT_STOCK)) missing.push('messageText parse site');
  if (!content.includes(ENGAGES_STOCK)) missing.push('evaluateEngage call site');
  if (!content.includes(DELIVER_WAKE_STOCK)) missing.push('deliverToAgent(wake=true) call site');
  if (!content.includes(DELIVER_SIG_STOCK)) missing.push('deliverToAgent signature');
  if (!content.includes(COMMAND_GATE_STOCK)) missing.push('command-gate condition');
  if (missing.length > 0) {
    throw new Error(
      `Cannot patch src/router.ts for webchat lobby routing — unsupported host shape (missing: ${missing.join(', ')}). ` +
        'Upgrade NanoClaw or apply the MyNanoClaw lobby-routing integration manually.',
    );
  }

  let next = content;
  if (!next.includes(ROUTING_IMPORT)) {
    next = insertImportAfterLastImport(next, ROUTING_IMPORT);
  }
  next = next.replace(SAFE_PARSE_STOCK, SAFE_PARSE_PATCHED);
  next = next.replace(MESSAGE_TEXT_STOCK, MESSAGE_TEXT_PATCHED);
  next = next.replace(ENGAGES_STOCK, ENGAGES_PATCHED);
  next = next.replace(DELIVER_WAKE_STOCK, DELIVER_WAKE_PATCHED);
  next = next.replace(DELIVER_SIG_STOCK, DELIVER_SIG_PATCHED);
  next = next.replace(COMMAND_GATE_STOCK, COMMAND_GATE_PATCHED);
  return { next, status: 'applied' };
}

/** Remove only our managed lobby-routing patch. Leaves MyNanoClaw-native equivalents alone. */
export function removeRouterLobbyRoutingContent(content: string): { next: string; status: HostPatchStatus } {
  if (!hasManagedRouterLobbyRouting(content)) {
    return { next: content, status: 'absent' };
  }

  let next = content;
  next = next.replace(`${ROUTING_IMPORT}\n`, '');
  next = next.replace(ROUTING_IMPORT, '');
  next = next.replace(SAFE_PARSE_PATCHED, SAFE_PARSE_STOCK);
  next = next.replace(MESSAGE_TEXT_PATCHED, MESSAGE_TEXT_STOCK);
  next = next.replace(ENGAGES_PATCHED, ENGAGES_STOCK);
  next = next.replace(DELIVER_WAKE_PATCHED, DELIVER_WAKE_STOCK);
  next = next.replace(DELIVER_SIG_PATCHED, DELIVER_SIG_STOCK);
  next = next.replace(COMMAND_GATE_PATCHED, COMMAND_GATE_STOCK);

  if (hasManagedRouterLobbyRouting(next)) {
    throw new Error('Failed to fully remove nanoclaw-webchat lobby-routing patch from src/router.ts');
  }
  return { next, status: 'removed' };
}

export function hasEquivalentDeliverySenderAttribution(content: string): boolean {
  return (
    content.includes('senderFolder') &&
    content.includes("msg.channel_type === 'web'") &&
    (content.includes('senderName') || content.includes('agent.name') || content.includes('agentGroup.name'))
  );
}

export function hasManagedDeliverySenderAttribution(content: string): boolean {
  return content.includes(DELIVERY_PATCH_MARKER);
}

const DELIVERY_ANCHOR_STOCK = `  const files =
    Array.isArray(content.files) && content.files.length > 0
      ? readOutboxFiles(session.agent_group_id, session.id, msg.id, content.files as string[])
      : undefined;

  const platformMsgId = await deliveryAdapter.deliver(
    msg.channel_type,
    msg.platform_id,
    msg.thread_id,
    msg.kind,
    msg.content,
    files,
    deliverInstance,
  );`;

const DELIVERY_ANCHOR_PATCHED = `  const files =
    Array.isArray(content.files) && content.files.length > 0
      ? readOutboxFiles(session.agent_group_id, session.id, msg.id, content.files as string[])
      : undefined;

${DELIVERY_STAMP_BLOCK}  const platformMsgId = await deliveryAdapter.deliver(
    msg.channel_type,
    msg.platform_id,
    msg.thread_id,
    msg.kind,
    deliveryContent,
    files,
    deliverInstance,
  );`;

const GET_AGENT_GROUP_IMPORT = "import { getAgentGroup } from './db/agent-groups.js';";

/** Apply web sender-attribution stamp. Pure — does not touch disk. */
export function applyDeliverySenderAttributionContent(content: string): {
  next: string;
  status: HostPatchStatus;
} {
  if (hasManagedDeliverySenderAttribution(content)) {
    return { next: content, status: 'already' };
  }
  if (hasEquivalentDeliverySenderAttribution(content)) {
    return { next: content, status: 'already-equivalent' };
  }
  if (!content.includes(DELIVERY_ANCHOR_STOCK)) {
    throw new Error(
      'Cannot patch src/delivery.ts for webchat sender attribution — unsupported host shape ' +
        '(expected stock deliverMessage files→deliver(msg.content) sequence). ' +
        'Upgrade NanoClaw or stamp senderName/senderFolder for web deliveries manually.',
    );
  }

  let next = content;
  if (!next.includes("from './db/agent-groups.js'") && !next.includes('from "./db/agent-groups.js"')) {
    next = insertImportAfterLastImport(next, GET_AGENT_GROUP_IMPORT);
  }
  next = next.replace(DELIVERY_ANCHOR_STOCK, DELIVERY_ANCHOR_PATCHED);
  return { next, status: 'applied' };
}

export function removeDeliverySenderAttributionContent(content: string): {
  next: string;
  status: HostPatchStatus;
} {
  if (!hasManagedDeliverySenderAttribution(content)) {
    return { next: content, status: 'absent' };
  }
  if (!content.includes(DELIVERY_ANCHOR_PATCHED)) {
    throw new Error('Failed to remove nanoclaw-webchat sender-attribution patch from src/delivery.ts');
  }
  let next = content.replace(DELIVERY_ANCHOR_PATCHED, DELIVERY_ANCHOR_STOCK);
  // Only remove getAgentGroup import if we added it and nothing else references it.
  // Conservative: leave the import if still referenced elsewhere (typical on real hosts).
  // Exactly one occurrence means only the import remains (no call sites / voids).
  if (
    next.includes(GET_AGENT_GROUP_IMPORT) &&
    !next.includes('getAgentGroup(') &&
    next.split('getAgentGroup').length === 2
  ) {
    next = next.replace(`${GET_AGENT_GROUP_IMPORT}\n`, '');
  }
  return { next, status: 'removed' };
}

function insertImportAfterLastImport(content: string, importLine: string): string {
  const importRe = /^import\s.+;$/gm;
  let lastIndex = -1;
  let match: RegExpExecArray | null;
  while ((match = importRe.exec(content)) !== null) {
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < 0) {
    return `${importLine}\n${content}`;
  }
  return `${content.slice(0, lastIndex)}\n${importLine}${content.slice(lastIndex)}`;
}

/** Write minimal stock-shaped router + delivery modules for install/CLI fixtures. */
export function writeStockHostModules(nanoclawRoot: string): void {
  const srcDir = path.join(nanoclawRoot, 'src');
  fs.mkdirSync(path.join(srcDir, 'db'), { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'router.ts'), STOCK_ROUTER_FIXTURE);
  fs.writeFileSync(path.join(srcDir, 'delivery.ts'), STOCK_DELIVERY_FIXTURE);
  const agentGroupsPath = path.join(srcDir, 'db/agent-groups.ts');
  if (!fs.existsSync(agentGroupsPath)) {
    fs.writeFileSync(
      agentGroupsPath,
      `export function getAgentGroup(_id: string): { name: string; folder: string } | undefined {
  return undefined;
}
`,
    );
  }
  const sessionManagerPath = path.join(srcDir, 'session-manager.ts');
  if (!fs.existsSync(sessionManagerPath)) {
    fs.writeFileSync(
      sessionManagerPath,
      `export function readOutboxFiles(
  _agentGroupId: string,
  _sessionId: string,
  _messageId: string,
  _files: string[],
): unknown[] {
  return [];
}
`,
    );
  }
  const typesPath = path.join(srcDir, 'types.ts');
  if (!fs.existsSync(typesPath)) {
    fs.writeFileSync(
      typesPath,
      `export type AgentGroup = { folder: string; name?: string };
export type MessagingGroup = { id: string; is_group: number };
export type MessagingGroupAgent = { ignored_message_policy?: string; agent_group_id?: string };
export type Session = { id: string; agent_group_id: string };
`,
    );
  }
  const adapterPath = path.join(srcDir, 'channels/adapter.ts');
  if (!fs.existsSync(adapterPath)) {
    fs.mkdirSync(path.dirname(adapterPath), { recursive: true });
    fs.writeFileSync(
      adapterPath,
      `export type InboundEvent = {
  message: { content: string; isMention?: boolean; kind?: string };
  threadId: string | null;
};
`,
    );
  }
}

export function applyRouterLobbyRoutingPatch(nanoclawRoot: string): HostPatchResult {
  const filePath = path.join(nanoclawRoot, 'src/router.ts');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot patch lobby routing: missing ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const { next, status } = applyRouterLobbyRoutingContent(content);
  if (status === 'applied') {
    fs.writeFileSync(filePath, next);
  }
  return { status, path: 'src/router.ts' };
}

export function removeRouterLobbyRoutingPatch(nanoclawRoot: string): HostPatchResult {
  const filePath = path.join(nanoclawRoot, 'src/router.ts');
  if (!fs.existsSync(filePath)) {
    return { status: 'absent', path: 'src/router.ts' };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const { next, status } = removeRouterLobbyRoutingContent(content);
  if (status === 'removed') {
    fs.writeFileSync(filePath, next);
  }
  return { status, path: 'src/router.ts' };
}

export function applyDeliverySenderAttributionPatch(nanoclawRoot: string): HostPatchResult {
  const filePath = path.join(nanoclawRoot, 'src/delivery.ts');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cannot patch sender attribution: missing ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const { next, status } = applyDeliverySenderAttributionContent(content);
  if (status === 'applied') {
    fs.writeFileSync(filePath, next);
  }
  return { status, path: 'src/delivery.ts' };
}

export function removeDeliverySenderAttributionPatch(nanoclawRoot: string): HostPatchResult {
  const filePath = path.join(nanoclawRoot, 'src/delivery.ts');
  if (!fs.existsSync(filePath)) {
    return { status: 'absent', path: 'src/delivery.ts' };
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const { next, status } = removeDeliverySenderAttributionContent(content);
  if (status === 'removed') {
    fs.writeFileSync(filePath, next);
  }
  return { status, path: 'src/delivery.ts' };
}

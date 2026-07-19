import type { InboundEvent } from './channels/adapter.js';
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

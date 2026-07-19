/**
 * Stock-shaped delivery module so `nanoclaw-webchat install` can apply the
 * web sender-attribution patch. Adapter tests mock delivery as needed.
 */
import { getAgentGroup } from './db/agent-groups.js';
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

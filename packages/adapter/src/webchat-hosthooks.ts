import {
  getHosthooksCapabilities,
  registerDeliveryPolicy,
  registerOutboundContentTransform,
  type ValidatedInboundParse,
} from './hosthooks.js';
import { isWebchatContextOnly, resolveWebchatReceiver } from './webchat-routing.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function registerWebchatHosthooks(): void {
  const capabilities = getHosthooksCapabilities();
  if (
    capabilities.apiVersion !== 1 ||
    !capabilities.features.deliveryPolicy ||
    !capabilities.features.outboundContentTransform
  ) {
    throw new Error(
      'nanoclaw-webchat requires nanoclaw-hosthooks API v1 with deliveryPolicy and outboundContentTransform',
    );
  }

  registerDeliveryPolicy('nanoclaw-webchat:lobby-routing', ({ parsed, agentGroup }) => {
    const receiver = resolveWebchatReceiver(parsed as ValidatedInboundParse);
    const agentFolder = nonEmptyString(asRecord(agentGroup)?.folder);
    const engages = receiver !== null && agentFolder !== null && receiver === agentFolder;
    const contextOnly = isWebchatContextOnly(parsed as ValidatedInboundParse);

    if (!engages && !contextOnly) return null;
    return {
      ...(engages ? { engages: true } : {}),
      ...(contextOnly ? { wake: false, skipCommandGate: true } : {}),
    };
  });

  registerOutboundContentTransform(
    'nanoclaw-webchat:sender-attribution',
    ({ content, message, agentGroup }) => {
      const msg = asRecord(message);
      if (msg?.channel_type !== 'web') return null;

      let parsed: UnknownRecord;
      try {
        const value = JSON.parse(content) as unknown;
        const record = asRecord(value);
        if (!record) return null;
        parsed = record;
      } catch {
        return null;
      }

      if (nonEmptyString(parsed.senderName)) return null;
      const group = asRecord(agentGroup);
      const senderName = nonEmptyString(group?.name);
      const senderFolder = nonEmptyString(group?.folder);
      if (!senderName || !senderFolder) return null;

      return JSON.stringify({ ...parsed, senderName, senderFolder });
    },
  );
}

export const HOSTHOOKS_API_VERSION = 1 as const;

export interface ValidatedInboundParse {
  text?: string;
  sender?: string;
  senderId?: string;
  [key: string]: unknown;
}

export interface DeliveryPolicyContext {
  parsed: ValidatedInboundParse;
  agentGroup: unknown;
}

export type DeliveryPolicy = (
  context: DeliveryPolicyContext,
) => { engages?: boolean; wake?: boolean; skipCommandGate?: boolean } | null | undefined;

export interface OutboundContentTransformContext {
  content: string;
  message: unknown;
  session: unknown;
  agentGroup: unknown;
  parsed: unknown;
}

export type OutboundContentTransform = (
  context: OutboundContentTransformContext,
) => string | null | undefined;

export function registerDeliveryPolicy(_name: string, _policy: DeliveryPolicy): () => void {
  return () => undefined;
}

export function registerOutboundContentTransform(
  _name: string,
  _transform: OutboundContentTransform,
): () => void {
  return () => undefined;
}

export function getHosthooksCapabilities() {
  return {
    apiVersion: HOSTHOOKS_API_VERSION,
    features: {
      deliveryPolicy: true,
      outboundContentTransform: true,
      providerMessageObserver: false,
      providerQueryOptions: false,
      inboundBatchObserver: false,
      containerEnv: true,
    },
    counts: {},
  };
}

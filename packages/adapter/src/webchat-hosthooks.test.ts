import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getHosthooksCapabilities, registerDeliveryPolicy, registerOutboundContentTransform } =
  vi.hoisted(() => ({
    getHosthooksCapabilities: vi.fn(),
    registerDeliveryPolicy: vi.fn(),
    registerOutboundContentTransform: vi.fn(),
  }));

vi.mock('./hosthooks.js', () => ({
  getHosthooksCapabilities,
  registerDeliveryPolicy,
  registerOutboundContentTransform,
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

import { registerWebchatHosthooks } from './webchat-hosthooks.js';

type DeliveryPolicy = (context: {
  parsed: Record<string, unknown>;
  agentGroup: unknown;
}) => Record<string, unknown> | null;

type OutboundTransform = (context: {
  content: string;
  message: unknown;
  agentGroup: unknown;
}) => string | null;

beforeEach(() => {
  vi.clearAllMocks();
  getHosthooksCapabilities.mockReturnValue({
    apiVersion: 1,
    features: {
      deliveryPolicy: true,
      outboundContentTransform: true,
    },
  });
});

function registrations(): { policy: DeliveryPolicy; transform: OutboundTransform } {
  registerWebchatHosthooks();
  return {
    policy: registerDeliveryPolicy.mock.calls[0]![1] as DeliveryPolicy,
    transform: registerOutboundContentTransform.mock.calls[0]![1] as OutboundTransform,
  };
}

describe('webchat hosthooks registration', () => {
  it('requires hosthooks API v1 capabilities', () => {
    getHosthooksCapabilities.mockReturnValue({
      apiVersion: 2,
      features: { deliveryPolicy: true, outboundContentTransform: true },
    });
    expect(() => registerWebchatHosthooks()).toThrow(/requires nanoclaw-hosthooks API v1/);

    getHosthooksCapabilities.mockReturnValue({
      apiVersion: 1,
      features: { deliveryPolicy: false, outboundContentTransform: true },
    });
    expect(() => registerWebchatHosthooks()).toThrow(/deliveryPolicy/);

    getHosthooksCapabilities.mockReturnValue({
      apiVersion: 1,
      features: { deliveryPolicy: true, outboundContentTransform: false },
    });
    expect(() => registerWebchatHosthooks()).toThrow(/outboundContentTransform/);
  });

  it('registers named delivery and outbound hooks', () => {
    registerWebchatHosthooks();
    expect(registerDeliveryPolicy).toHaveBeenCalledWith(
      'nanoclaw-webchat:lobby-routing',
      expect.any(Function),
    );
    expect(registerOutboundContentTransform).toHaveBeenCalledWith(
      'nanoclaw-webchat:sender-attribution',
      expect.any(Function),
    );
  });

  it('opts in the matching receiver without rewriting defaults', () => {
    const { policy } = registrations();
    expect(
      policy({
        parsed: { webchatReceiver: 'sarah' },
        agentGroup: { folder: 'sarah' },
      }),
    ).toEqual({ engages: true });
    expect(
      policy({
        parsed: { webchatReceiver: 'sarah' },
        agentGroup: { folder: 'diego' },
      }),
    ).toBeNull();
    expect(
      policy({
        parsed: { webchatReceiver: 'sarah' },
        agentGroup: { folder: '   ' },
      }),
    ).toBeNull();
    expect(policy({ parsed: { webchatReceiver: 3 }, agentGroup: null })).toBeNull();
  });

  it('makes peer, synthetic, and historical deliveries context-only', () => {
    const { policy } = registrations();
    for (const parsed of [
      { routing: { isPeerReply: true } },
      { synthetic: true },
      { historicalReplay: true },
    ]) {
      expect(policy({ parsed, agentGroup: { folder: 'sarah' } })).toEqual({
        wake: false,
        skipCommandGate: true,
      });
    }
    expect(
      policy({
        parsed: { webchatReceiver: 'sarah', synthetic: true },
        agentGroup: { folder: 'sarah' },
      }),
    ).toEqual({ engages: true, wake: false, skipCommandGate: true });
  });

  it('stamps bare web outbound content from the agent group', () => {
    const { transform } = registrations();
    const result = transform({
      content: JSON.stringify({ text: 'On it' }),
      message: { channel_type: 'web' },
      agentGroup: { name: 'Sarah', folder: 'sarah' },
    });
    expect(JSON.parse(result!)).toEqual({
      text: 'On it',
      senderName: 'Sarah',
      senderFolder: 'sarah',
    });
  });

  it('preserves attributed, non-web, malformed, and incomplete content', () => {
    const { transform } = registrations();
    expect(
      transform({
        content: JSON.stringify({ text: 'On it', senderName: 'Diego' }),
        message: { channel_type: 'web' },
        agentGroup: { name: 'Sarah', folder: 'sarah' },
      }),
    ).toBeNull();
    expect(
      transform({
        content: JSON.stringify({ text: 'On it' }),
        message: { channel_type: 'telegram' },
        agentGroup: { name: 'Sarah', folder: 'sarah' },
      }),
    ).toBeNull();
    expect(
      transform({
        content: 'not-json',
        message: { channel_type: 'web' },
        agentGroup: { name: 'Sarah', folder: 'sarah' },
      }),
    ).toBeNull();
    expect(
      transform({
        content: '[]',
        message: { channel_type: 'web' },
        agentGroup: { name: 'Sarah', folder: 'sarah' },
      }),
    ).toBeNull();
    expect(
      transform({
        content: JSON.stringify({ text: 'On it' }),
        message: null,
        agentGroup: { name: 'Sarah', folder: 'sarah' },
      }),
    ).toBeNull();
    expect(
      transform({
        content: JSON.stringify({ text: 'On it' }),
        message: { channel_type: 'web' },
        agentGroup: { name: 'Sarah' },
      }),
    ).toBeNull();
  });
});

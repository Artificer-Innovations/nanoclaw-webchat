import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  registerDeliveryAction,
  reenterGuardedDeliveryAction,
  registerApprovalHandler,
  getApprovalHandler,
  createAgent,
  requestCreateAgentHold,
  validateCreateAgent,
  agentsCreate,
  notifyAgent,
  refreshWebchatAfterAgentChange,
  approvalContinuation,
  registerWebchatHosthooks,
} = vi.hoisted(() => {
  const approvalContinuation = vi.fn();
  return {
    registerDeliveryAction: vi.fn(),
    reenterGuardedDeliveryAction: vi.fn(() => approvalContinuation),
    registerApprovalHandler: vi.fn(),
    getApprovalHandler: vi.fn(() => undefined),
    createAgent: vi.fn(async () => undefined),
    requestCreateAgentHold: vi.fn(),
    validateCreateAgent: vi.fn(),
    agentsCreate: { name: 'agents.create' },
    notifyAgent: vi.fn(),
    refreshWebchatAfterAgentChange: vi.fn(),
    registerWebchatHosthooks: vi.fn(),
    approvalContinuation,
  };
});

vi.mock('./log.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('./env.js', () => ({
  readEnvFile: vi.fn(() => ({ WEBCHAT_ENABLED: 'true', WEBCHAT_PORT: '3200' })),
}));

vi.mock('./webchat-sync.js', () => ({ syncWebchatWirings: vi.fn() }));
vi.mock('./webchat-store.js', () => ({ ensureWebchatSchema: vi.fn() }));
vi.mock('./webchat-live.js', () => ({ refreshWebchatAfterAgentChange }));
vi.mock('./webchat-hosthooks.js', () => ({ registerWebchatHosthooks }));

vi.mock('./delivery.js', () => ({
  registerDeliveryAction,
  reenterGuardedDeliveryAction,
}));

vi.mock('./modules/approvals/index.js', () => ({ notifyAgent }));
vi.mock('./modules/approvals/primitive.js', () => ({
  registerApprovalHandler,
  getApprovalHandler,
}));
vi.mock('./modules/agent-to-agent/create-agent.js', () => ({
  createAgent,
  requestCreateAgentHold,
  validateCreateAgent,
}));
vi.mock('./modules/agent-to-agent/guard.js', () => ({ agentsCreate }));

import { startWebChat } from './webchat-boot.js';
import { log } from './log.js';

beforeEach(() => {
  process.env.WEBCHAT_ENABLED = 'true';
  vi.clearAllMocks();
  getApprovalHandler.mockReturnValue(undefined);
  reenterGuardedDeliveryAction.mockReturnValue(approvalContinuation);
});

afterEach(() => {
  delete process.env.WEBCHAT_ENABLED;
});

describe('startWebChat create_agent guard wiring', () => {
  it('registers hosthooks before starting webchat', async () => {
    await startWebChat();
    expect(registerWebchatHosthooks).toHaveBeenCalledTimes(1);
  });

  it('registers create_agent with guardAction/precheck/requestHold/onDeny', async () => {
    await startWebChat();

    expect(registerDeliveryAction).toHaveBeenCalledTimes(1);
    expect(registerDeliveryAction).toHaveBeenCalledWith(
      'create_agent',
      expect.any(Function),
      {
        guardAction: agentsCreate,
        precheck: validateCreateAgent,
        requestHold: requestCreateAgentHold,
        onDeny: expect.any(Function),
      },
    );

    expect(reenterGuardedDeliveryAction).toHaveBeenCalledWith('create_agent');
    expect(registerApprovalHandler).toHaveBeenCalledWith('create_agent', approvalContinuation);
    expect(log.info).toHaveBeenCalledWith('Webchat create_agent live refresh installed');
  });

  it('refreshes webchat after create_agent succeeds', async () => {
    await startWebChat();
    const handler = registerDeliveryAction.mock.calls[0]![1] as (
      content: unknown,
      session: unknown,
    ) => Promise<void>;
    const session = { id: 's1' };
    await handler({ name: 'x' }, session);
    expect(createAgent).toHaveBeenCalledWith({ name: 'x' }, session);
    expect(refreshWebchatAfterAgentChange).toHaveBeenCalled();
  });

  it('onDeny notifies the agent with the deny reason', async () => {
    await startWebChat();
    const spec = registerDeliveryAction.mock.calls[0]![2] as {
      onDeny: (content: unknown, session: unknown, reason: string) => void;
    };
    const session = { id: 's1' };
    spec.onDeny({}, session, 'not allowed');
    expect(notifyAgent).toHaveBeenCalledWith(session, 'create_agent denied: not allowed');
  });

  it('warns (not debug) when guard wiring fails to attach', async () => {
    registerDeliveryAction.mockImplementationOnce(() => {
      throw new Error('missing host module');
    });
    await startWebChat();
    expect(log.warn).toHaveBeenCalledWith(
      'Webchat agent-group live refresh unavailable',
      expect.objectContaining({ err: expect.any(Error) }),
    );
    expect(log.debug).not.toHaveBeenCalledWith(
      'Webchat agent-group live refresh unavailable',
      expect.anything(),
    );
  });
});

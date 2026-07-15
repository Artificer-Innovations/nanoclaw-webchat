/**
 * Skill entry point — sync wirings before channel adapters start.
 */
import { log } from './log.js';
import { readEnvFile } from './env.js';
import { syncWebchatWirings } from './webchat-sync.js';
import { ensureWebchatSchema } from './webchat-store.js';
import { refreshWebchatAfterAgentChange } from './webchat-live.js';

/**
 * Re-register create_agent handlers so new agent groups get webchat lobby/DM
 * wirings + a live bootstrap push without requiring a host restart.
 *
 * Uses dynamic imports so hosts without agent-to-agent modules (test fixtures)
 * still boot cleanly.
 */
async function installCreateAgentLiveRefresh(): Promise<void> {
  try {
    const { registerDeliveryAction } = await import('./delivery.js');
    const { registerApprovalHandler } = await import('./modules/approvals/index.js');
    const { applyCreateAgent, handleCreateAgent } = await import(
      './modules/agent-to-agent/create-agent.js'
    );

    registerDeliveryAction('create_agent', async (content, session) => {
      await handleCreateAgent(content, session);
      // Idempotent even when the handler only queued an approval.
      refreshWebchatAfterAgentChange();
    });

    registerApprovalHandler('create_agent', async (ctx) => {
      await applyCreateAgent(ctx);
      refreshWebchatAfterAgentChange();
    });

    log.info('Webchat create_agent live refresh installed');
  } catch (err) {
    log.debug('Webchat create_agent live refresh unavailable', { err });
  }
}

export async function startWebChat(): Promise<void> {
  const env = readEnvFile(['WEBCHAT_ENABLED', 'WEBCHAT_PORT']);
  const enabled = process.env.WEBCHAT_ENABLED || env.WEBCHAT_ENABLED;
  if (!enabled || enabled === 'false') {
    log.info('Web chat disabled (WEBCHAT_ENABLED not set)');
    return;
  }

  syncWebchatWirings();
  ensureWebchatSchema();
  await installCreateAgentLiveRefresh();
  const port = process.env.WEBCHAT_PORT || env.WEBCHAT_PORT || '3200';
  log.info('Web chat enabled — open http://127.0.0.1:' + port);
}

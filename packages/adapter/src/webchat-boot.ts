/**
 * Skill entry point — sync wirings before channel adapters start.
 */
import { log } from './log.js';
import { readEnvFile } from './env.js';
import { syncWebchatWirings } from './webchat-sync.js';
import { ensureWebchatSchema } from './webchat-store.js';
import { refreshWebchatAfterAgentChange } from './webchat-live.js';

/**
 * Re-register handlers so agent-group create/delete refresh webchat lobby/DM
 * wirings + push a live bootstrap without requiring a host restart.
 *
 * Host `registerDeliveryAction` / `registerApprovalHandler` REPLACE prior
 * handlers for the same key (Map.set, with a warn log). Agent-to-agent / CLI
 * modules register the bare handlers at import time; we overwrite them with
 * wrappers that call those same functions then refresh webchat. Hosts that
 * never call `startWebChat` keep the original bare handlers.
 *
 * Uses dynamic imports so hosts without those modules (test fixtures) still
 * boot cleanly.
 */
async function installAgentGroupLiveRefresh(): Promise<void> {
  try {
    const { registerDeliveryAction } = await import('./delivery.js');
    const { registerApprovalHandler, getApprovalHandler } = await import(
      './modules/approvals/primitive.js'
    );
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

    // Wrap CLI delete (and only delete) so approved `ncl groups delete` drops
    // DMs from connected browsers. Must keep the original handler's notify path.
    const existingCli = getApprovalHandler('cli_command');
    if (existingCli) {
      registerApprovalHandler('cli_command', async (ctx) => {
        await existingCli(ctx);
        const frame = ctx.payload?.frame as { command?: string } | undefined;
        if (frame?.command === 'groups-delete') {
          refreshWebchatAfterAgentChange();
        }
      });
      log.info('Webchat groups-delete live refresh installed');
    }

    log.info('Webchat create_agent live refresh installed');
  } catch (err) {
    log.debug('Webchat agent-group live refresh unavailable', { err });
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
  await installAgentGroupLiveRefresh();
  const port = process.env.WEBCHAT_PORT || env.WEBCHAT_PORT || '3200';
  log.info('Web chat enabled — open http://127.0.0.1:' + port);
}

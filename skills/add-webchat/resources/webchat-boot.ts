/**
 * Skill entry point — sync wirings before channel adapters start.
 */
import { log } from './log.js';
import { readEnvFile } from './env.js';
import { syncWebchatWirings } from './webchat-sync.js';
import { ensureWebchatSchema } from './webchat-store.js';

export async function startWebChat(): Promise<void> {
  const env = readEnvFile(['WEBCHAT_ENABLED', 'WEBCHAT_PORT']);
  const enabled = process.env.WEBCHAT_ENABLED || env.WEBCHAT_ENABLED;
  if (!enabled || enabled === 'false') {
    log.info('Web chat disabled (WEBCHAT_ENABLED not set)');
    return;
  }

  syncWebchatWirings();
  ensureWebchatSchema();
  const port = process.env.WEBCHAT_PORT || env.WEBCHAT_PORT || '3200';
  log.info('Web chat enabled — open http://127.0.0.1:' + port);
}

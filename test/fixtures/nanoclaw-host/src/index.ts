/**
 * Minimal NanoClaw host entry for integration tests.
 */
import { initDb } from './db/connection.js';
import { runMigrations } from './db/migrations/index.js';
import {
  initChannelAdapters,
  type ChannelAdapter,
} from './channels/channel-registry.js';
import type { ChannelSetup } from './channels/adapter.js';
import { routeInbound } from './router.js';
import { DATA_DIR } from './config.js';
import path from 'path';

async function main(): Promise<void> {
  const dbPath = path.join(DATA_DIR, 'v2.db');
  initDb(dbPath);
  runMigrations(db);

  await initChannelAdapters((adapter: ChannelAdapter): ChannelSetup => {
    return {
      onInbound(platformId, threadId, message) {
        routeInbound({
          channelType: adapter.channelType,
          instance: adapter.instance ?? adapter.channelType,
          platformId,
          threadId,
          message: {
            id: message.id,
            kind: message.kind,
            content: JSON.stringify(message.content),
            timestamp: message.timestamp,
            isMention: message.isMention,
            isGroup: message.isGroup,
          },
        });
      },
      onInboundEvent(event) {
        routeInbound(event);
      },
      onMetadata() {},
      onAction() {},
    };
  });
}

void main();

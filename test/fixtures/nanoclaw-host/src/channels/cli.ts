import { registerChannelAdapter } from './channel-registry.js';
import type { ChannelAdapter, ChannelSetup } from './adapter.js';

function createAdapter(): ChannelAdapter {
  return {
    name: 'cli',
    channelType: 'cli',
    async setup(_setup: ChannelSetup) {},
    async teardown() {},
    async deliver() {
      return false;
    },
  };
}

registerChannelAdapter('cli', { factory: createAdapter });

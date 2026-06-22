/**
 * Integration test for the web channel's single reach-in: the self-registration
 * import in the `src/channels/index.ts` barrel.
 */
import { describe, it, expect } from 'vitest';

import { getRegisteredChannelNames } from './channel-registry.js';
import './index.js';

describe('web channel registration', () => {
  it('registers web via the channel barrel', () => {
    expect(getRegisteredChannelNames()).toContain('web');
  });
});

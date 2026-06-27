/**
 * Integration test for the web channel's single reach-in: the self-registration
 * import in the `src/channels/index.ts` barrel.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('../env.js', () => ({
  readEnvFile: vi.fn(() => ({})),
}));

vi.mock('nanoclaw-webchat', () => ({
  getAssetDir: () => '/tmp/nanoclaw-webchat-registration-assets',
}));

import { readEnvFile } from '../env.js';
import { getRegisteredChannelNames, getActiveAdapters, initChannelAdapters, teardownChannelAdapters } from './channel-registry.js';
import { resolveWebchatPort } from './web.js';
import './index.js';
import './web.js';

const setupFn = () => ({
  onInbound() {},
  onInboundEvent() {},
  onMetadata() {},
  onAction() {},
});

describe('web channel registration', () => {
  it('registers web via the channel barrel', () => {
    expect(getRegisteredChannelNames()).toContain('web');
  });
});

describe('web channel factory', () => {
  beforeEach(async () => {
    vi.mocked(readEnvFile).mockReturnValue({});
    await teardownChannelAdapters();
  });

  afterEach(async () => {
    await teardownChannelAdapters();
    delete process.env.WEBCHAT_ENABLED;
    delete process.env.WEBCHAT_SECRET;
    delete process.env.WEBCHAT_PORT;
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
  });

  it('skips adapter when WEBCHAT_ENABLED is false', async () => {
    process.env.WEBCHAT_ENABLED = 'false';
    await initChannelAdapters(setupFn);
    expect(getActiveAdapters().some((a) => a.channelType === 'web')).toBe(false);
  });

  it('skips adapter when enabled but WEBCHAT_SECRET is missing', async () => {
    process.env.WEBCHAT_ENABLED = 'true';
    delete process.env.WEBCHAT_SECRET;
    await initChannelAdapters(setupFn);
    expect(getActiveAdapters().some((a) => a.channelType === 'web')).toBe(false);
  });

  it('starts adapter when enabled and secret is present', async () => {
    process.env.WEBCHAT_ENABLED = 'true';
    process.env.WEBCHAT_SECRET = 'factory-secret';
    process.env.WEBCHAT_PORT = '39999';
    await initChannelAdapters(setupFn);
    const webAdapter = getActiveAdapters().find((a) => a.channelType === 'web');
    expect(webAdapter).toBeDefined();
    expect(webAdapter!.isConnected()).toBe(true);
    await webAdapter!.teardown();
  });

  it('starts adapter using env file values when process env is unset', async () => {
    vi.mocked(readEnvFile).mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_SECRET: 'env-secret',
      WEBCHAT_PORT: '39998',
      WEBCHAT_USER_ID: 'web:env',
      WEBCHAT_DISPLAY_NAME: 'Env User',
    });
    delete process.env.WEBCHAT_ENABLED;
    delete process.env.WEBCHAT_SECRET;
    delete process.env.WEBCHAT_PORT;
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
    await initChannelAdapters(setupFn);
    const webAdapter = getActiveAdapters().find((a) => a.channelType === 'web');
    expect(webAdapter).toBeDefined();
    expect(webAdapter!.isConnected()).toBe(true);
    await webAdapter!.teardown();
  });

  it('skips adapter when enabled flag comes only from env file as false', async () => {
    vi.mocked(readEnvFile).mockReturnValue({ WEBCHAT_ENABLED: 'false' });
    delete process.env.WEBCHAT_ENABLED;
    await initChannelAdapters(setupFn);
    expect(getActiveAdapters().some((a) => a.channelType === 'web')).toBe(false);
  });

  it('uses default user identity when env omits optional fields', async () => {
    vi.mocked(readEnvFile).mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_SECRET: 'env-secret',
      WEBCHAT_PORT: '39996',
    });
    delete process.env.WEBCHAT_ENABLED;
    delete process.env.WEBCHAT_SECRET;
    delete process.env.WEBCHAT_PORT;
    delete process.env.WEBCHAT_USER_ID;
    delete process.env.WEBCHAT_DISPLAY_NAME;
    await initChannelAdapters(setupFn);
    const webAdapter = getActiveAdapters().find((a) => a.channelType === 'web');
    expect(webAdapter).toBeDefined();
    expect(webAdapter!.isConnected()).toBe(true);
    await webAdapter!.teardown();
  });

  it('uses default port 3200 when WEBCHAT_PORT is unset', () => {
    delete process.env.WEBCHAT_PORT;
    expect(resolveWebchatPort({})).toBe(3200);
    expect(resolveWebchatPort({ WEBCHAT_PORT: '4100' })).toBe(4100);
  });

  it('starts adapter in public auth mode when configured', async () => {
    vi.mocked(readEnvFile).mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_SECRET: 'factory-secret',
      WEBCHAT_PORT: '39995',
      WEBCHAT_AUTH_MODE: 'public',
      WEBCHAT_SESSION_SECRET: 'a'.repeat(32),
      WEBCHAT_AUTH_BASIC_ENABLED: 'true',
      WEBCHAT_BASIC_PASSWORD: 'pass',
      WEBCHAT_BASIC_ALLOWED_USERNAMES: 'alice',
    });
    delete process.env.WEBCHAT_ENABLED;
    delete process.env.WEBCHAT_SECRET;
    delete process.env.WEBCHAT_PORT;
    await initChannelAdapters(setupFn);
    const webAdapter = getActiveAdapters().find((a) => a.channelType === 'web');
    expect(webAdapter).toBeDefined();
    expect(webAdapter!.isConnected()).toBe(true);
    await webAdapter!.teardown();
  });

  it('skips adapter when public auth configuration is invalid', async () => {
    vi.mocked(readEnvFile).mockReturnValue({
      WEBCHAT_ENABLED: 'true',
      WEBCHAT_SECRET: 'factory-secret',
      WEBCHAT_AUTH_MODE: 'public',
    });
    delete process.env.WEBCHAT_ENABLED;
    delete process.env.WEBCHAT_SECRET;
    await initChannelAdapters(setupFn);
    expect(getActiveAdapters().some((a) => a.channelType === 'web')).toBe(false);
  });
});

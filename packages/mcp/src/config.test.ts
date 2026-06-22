import { describe, it, expect } from 'vitest';
import { DEFAULT_REQUEST_TIMEOUT_MS } from './client.js';
import { DEFAULT_API_BASE, loadConfig } from './config.js';

describe('config', () => {
  it('loadConfig requires WEBCHAT_SECRET', () => {
    expect(() => loadConfig({})).toThrow('WEBCHAT_SECRET is required');
    expect(() => loadConfig({ WEBCHAT_SECRET: '   ' })).toThrow('WEBCHAT_SECRET is required');
  });

  it('loadConfig uses defaults', () => {
    const config = loadConfig({ WEBCHAT_SECRET: 'secret' });
    expect(config.apiBase).toBe(DEFAULT_API_BASE);
    expect(config.secret).toBe('secret');
    expect(config.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  it('loadConfig honors env overrides', () => {
    const config = loadConfig({
      WEBCHAT_SECRET: 's',
      WEBCHAT_API_BASE: 'http://localhost:4000/',
      WEBCHAT_REQUEST_TIMEOUT_MS: '45000',
    });
    expect(config.apiBase).toBe('http://localhost:4000');
    expect(config.requestTimeoutMs).toBe(45_000);
  });

  it('loadConfig strips trailing slash from WEBCHAT_API_BASE', () => {
    const config = loadConfig({
      WEBCHAT_SECRET: 's',
      WEBCHAT_API_BASE: 'http://localhost:4000/',
    });
    expect(config.apiBase).toBe('http://localhost:4000');
  });

  it('loadConfig preserves WEBCHAT_API_BASE without trailing slash', () => {
    const config = loadConfig({
      WEBCHAT_SECRET: 's',
      WEBCHAT_API_BASE: 'http://localhost:4000',
    });
    expect(config.apiBase).toBe('http://localhost:4000');
  });

  it('loadConfig ignores invalid timeout override', () => {
    const config = loadConfig({
      WEBCHAT_SECRET: 's',
      WEBCHAT_REQUEST_TIMEOUT_MS: 'not-a-number',
    });
    expect(config.requestTimeoutMs).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./config.js', () => ({
  loadConfig: vi.fn(() => ({
    apiBase: 'http://127.0.0.1:3200',
    secret: 'secret',
  })),
}));

const connect = vi.fn().mockResolvedValue(undefined);
vi.mock('./server.js', () => ({
  createWebchatMcpServer: vi.fn(() => ({ connect })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

describe('index entry', () => {
  beforeEach(() => {
    vi.resetModules();
    connect.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('loads config, creates server, and connects transport', async () => {
    const { loadConfig } = await import('./config.js');
    const { createWebchatMcpServer } = await import('./server.js');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
    await import('./index.js');
    expect(loadConfig).toHaveBeenCalled();
    expect(createWebchatMcpServer).toHaveBeenCalledWith({
      config: { apiBase: 'http://127.0.0.1:3200', secret: 'secret' },
    });
    expect(StdioServerTransport).toHaveBeenCalled();
    expect(connect).toHaveBeenCalled();
  });
});

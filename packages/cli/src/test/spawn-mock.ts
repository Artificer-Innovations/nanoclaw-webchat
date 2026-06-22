import { vi } from 'vitest';

export const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAssetDir } from './index';

describe('index', () => {
  it('getAssetDir returns the client asset directory', () => {
    const assetDir = getAssetDir();
    expect(path.basename(assetDir)).toBe('client');
    expect(path.isAbsolute(assetDir)).toBe(true);
  });
});

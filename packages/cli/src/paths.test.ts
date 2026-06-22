import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { packageRoot, readPackageVersion } from './paths.js';

describe('packageRoot failure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when package root cannot be located', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    expect(() => packageRoot()).toThrow('Could not locate');
  });
});

describe('readPackageVersion', () => {
  it('falls back when version field is missing', () => {
    const originalRead = fs.readFileSync.bind(fs);
    const read = vi.spyOn(fs, 'readFileSync').mockImplementation((target, encoding) => {
      const p = String(target);
      if (p.endsWith('package.json') && p.includes('nanoclaw-webchat')) {
        return JSON.stringify({ name: '@artificer-innovations/nanoclaw-webchat' });
      }
      return originalRead(target, encoding as BufferEncoding);
    });
    try {
      expect(readPackageVersion()).toBe('0.0.0');
    } finally {
      read.mockRestore();
    }
  });
});

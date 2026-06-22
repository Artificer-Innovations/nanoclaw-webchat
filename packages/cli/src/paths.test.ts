import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapterSrcDir, packageRoot, readPackageVersion, resourcesDir } from './paths.js';

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

describe('resourcesDir', () => {
  it('falls back to skill resources when adapter src is absent', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-'));
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify({ name: '@artificer-innovations/nanoclaw-webchat' }),
    );
    fs.mkdirSync(path.join(temp, 'skills/add-webchat/resources'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'skills/add-webchat/resources/web.ts'), 'export {};\n');
    expect(resourcesDir()).toBe(path.join(packageRoot(), 'packages/adapter/src'));
    expect(resourcesDir(temp)).toBe(path.join(temp, 'skills/add-webchat/resources'));
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it('adapterSrcDir resolves under package root', () => {
    expect(adapterSrcDir()).toBe(path.join(packageRoot(), 'packages/adapter/src'));
  });
});

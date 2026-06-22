import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapterSrcDir, packageRoot, readPackageVersion, resourcesDir } from './paths.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('packageRoot failure', () => {
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
        return JSON.stringify({ name: 'nanoclaw-webchat' });
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
  it('resolves packages/adapter/src in monorepo', () => {
    expect(resourcesDir()).toBe(path.join(packageRoot(), 'packages/adapter/src'));
    expect(fs.existsSync(path.join(resourcesDir(), 'web.ts'))).toBe(true);
  });

  it('falls back to skill resources when adapter src is absent', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-'));
    tempDirs.push(temp);
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify({ name: 'nanoclaw-webchat' }),
    );
    fs.mkdirSync(path.join(temp, 'skills/add-webchat/resources'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'skills/add-webchat/resources/web.ts'), 'export {};\n');
    expect(resourcesDir(temp)).toBe(path.join(temp, 'skills/add-webchat/resources'));
  });

  it('falls back when adapter src exists but web.ts is missing', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-empty-'));
    tempDirs.push(temp);
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify({ name: 'nanoclaw-webchat' }),
    );
    fs.mkdirSync(path.join(temp, 'packages/adapter/src'), { recursive: true });
    fs.mkdirSync(path.join(temp, 'skills/add-webchat/resources'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'skills/add-webchat/resources/web.ts'), 'export {};\n');
    expect(resourcesDir(temp)).toBe(path.join(temp, 'skills/add-webchat/resources'));
  });

  it('adapterSrcDir resolves under package root', () => {
    expect(adapterSrcDir()).toBe(path.join(packageRoot(), 'packages/adapter/src'));
  });
});

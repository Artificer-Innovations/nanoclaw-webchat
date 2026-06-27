import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adapterSrcDir, packageRoot, readPackageVersion, resolveLinkedAdapterSrc, resourcesDir } from './paths.js';

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

  it('resolves file: linked monorepo adapter src from host root', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-link-'));
    tempDirs.push(temp);
    const monorepo = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-monorepo-'));
    tempDirs.push(monorepo);
    fs.mkdirSync(path.join(monorepo, 'packages/adapter/src'), { recursive: true });
    fs.writeFileSync(path.join(monorepo, 'packages/adapter/src/web.ts'), 'export {};\n');
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify({
        name: 'nanoclaw-host',
        dependencies: { 'nanoclaw-webchat': `file:${monorepo}` },
      }),
    );
    fs.writeFileSync(
      path.join(monorepo, 'package.json'),
      JSON.stringify({ name: 'nanoclaw-webchat' }),
    );
    fs.mkdirSync(path.join(monorepo, 'skills/add-webchat/resources'), { recursive: true });
    expect(resolveLinkedAdapterSrc(temp)).toBe(path.join(monorepo, 'packages/adapter/src'));
    expect(resourcesDir(monorepo, temp)).toBe(path.join(monorepo, 'packages/adapter/src'));
  });

  it('returns null when host package.json is missing', () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-no-pkg-'));
    tempDirs.push(host);
    expect(resolveLinkedAdapterSrc(host)).toBeNull();
  });

  it('returns null when host does not use a file: nanoclaw-webchat dependency', () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-npm-dep-'));
    tempDirs.push(host);
    fs.writeFileSync(
      path.join(host, 'package.json'),
      JSON.stringify({
        name: 'nanoclaw-host',
        dependencies: { 'nanoclaw-webchat': '^0.1.0' },
      }),
    );
    expect(resolveLinkedAdapterSrc(host)).toBeNull();
  });

  it('falls back to skill resources when file: link cannot be resolved', () => {
    const published = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-published-fallback-'));
    tempDirs.push(published);
    fs.writeFileSync(
      path.join(published, 'package.json'),
      JSON.stringify({ name: 'nanoclaw-webchat' }),
    );
    fs.mkdirSync(path.join(published, 'skills/add-webchat/resources'), { recursive: true });
    fs.writeFileSync(
      path.join(published, 'skills/add-webchat/resources/web.ts'),
      'export {};\n',
    );

    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-host-unlinked-'));
    tempDirs.push(host);
    fs.writeFileSync(
      path.join(host, 'package.json'),
      JSON.stringify({
        name: 'nanoclaw-host',
        dependencies: { 'nanoclaw-webchat': '^0.1.0' },
      }),
    );

    expect(resourcesDir(published, host)).toBe(
      path.join(published, 'skills/add-webchat/resources'),
    );
  });

  it('returns null when linked monorepo adapter src lacks web.ts', () => {
    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-link-missing-'));
    tempDirs.push(host);
    const monorepo = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-monorepo-empty-'));
    tempDirs.push(monorepo);
    fs.mkdirSync(path.join(monorepo, 'packages/adapter/src'), { recursive: true });
    fs.writeFileSync(
      path.join(host, 'package.json'),
      JSON.stringify({
        name: 'nanoclaw-host',
        dependencies: { 'nanoclaw-webchat': `file:${monorepo}` },
      }),
    );
    expect(resolveLinkedAdapterSrc(host)).toBeNull();
  });

  it('uses file: linked adapter src when published package lacks monorepo adapter tree', () => {
    const published = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-published-'));
    tempDirs.push(published);
    fs.writeFileSync(
      path.join(published, 'package.json'),
      JSON.stringify({ name: 'nanoclaw-webchat' }),
    );
    fs.mkdirSync(path.join(published, 'skills/add-webchat/resources'), { recursive: true });
    fs.writeFileSync(
      path.join(published, 'skills/add-webchat/resources/web.ts'),
      'export {};\n',
    );

    const host = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-host-'));
    tempDirs.push(host);
    const monorepo = fs.mkdtempSync(path.join(os.tmpdir(), 'resources-dir-linked-monorepo-'));
    tempDirs.push(monorepo);
    fs.mkdirSync(path.join(monorepo, 'packages/adapter/src'), { recursive: true });
    fs.writeFileSync(path.join(monorepo, 'packages/adapter/src/web.ts'), 'export {};\n');
    fs.writeFileSync(
      path.join(host, 'package.json'),
      JSON.stringify({
        name: 'nanoclaw-host',
        dependencies: { 'nanoclaw-webchat': `file:${monorepo}` },
      }),
    );

    expect(resourcesDir(published, host)).toBe(path.join(monorepo, 'packages/adapter/src'));
  });
});

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
    const pkgPath = path.join(packageRoot(), 'package.json');
    const original = fs.readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(original) as Record<string, unknown>;
    delete parsed.version;
    fs.writeFileSync(pkgPath, JSON.stringify(parsed));
    try {
      expect(readPackageVersion()).toBe('0.0.0');
    } finally {
      fs.writeFileSync(pkgPath, original);
    }
  });
});

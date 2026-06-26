import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureHostAdapterDependencies, syncSkillToFork } from './patch.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('ensureHostAdapterDependencies', () => {
  it('adds busboy runtime and type packages when missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-deps-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify({ name: 'host', dependencies: {} }, null, 2)}\n`,
    );

    const added = ensureHostAdapterDependencies(root);
    expect(added).toEqual(['busboy', '@types/busboy']);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.dependencies.busboy).toBe('^1.6.0');
    expect(pkg.devDependencies['@types/busboy']).toBe('^1.5.4');
  });

  it('returns empty when package.json is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-deps-'));
    tempDirs.push(root);
    expect(ensureHostAdapterDependencies(root)).toEqual([]);
  });

  it('returns empty when host dependencies are already present', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-deps-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'host',
          dependencies: { busboy: '^1.6.0' },
          devDependencies: { '@types/busboy': '^1.5.4' },
        },
        null,
        2,
      )}\n`,
    );
    expect(ensureHostAdapterDependencies(root)).toEqual([]);
  });

  it('adds only missing dev dependency when runtime is already installed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-deps-'));
    tempDirs.push(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      `${JSON.stringify({ name: 'host', dependencies: { busboy: '^1.6.0' } }, null, 2)}\n`,
    );
    expect(ensureHostAdapterDependencies(root)).toEqual(['@types/busboy']);
  });
});

describe('syncSkillToFork', () => {
  it('copies nested skill directories', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-host-'));
    tempDirs.push(root);
    const skillSource = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-src-'));
    tempDirs.push(skillSource);
    fs.writeFileSync(path.join(skillSource, 'SKILL.md'), '# skill\n');
    fs.mkdirSync(path.join(skillSource, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(skillSource, 'resources', 'web.ts'), 'export {};\n');

    const dest = syncSkillToFork(root, skillSource);

    expect(dest).toBe(path.join(root, '.claude/skills/add-webchat'));
    expect(fs.readFileSync(path.join(dest, 'SKILL.md'), 'utf8')).toBe('# skill\n');
    expect(fs.readFileSync(path.join(dest, 'resources', 'web.ts'), 'utf8')).toBe('export {};\n');
  });
});

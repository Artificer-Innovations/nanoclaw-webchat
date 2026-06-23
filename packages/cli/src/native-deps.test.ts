import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSyncMock } from './test/spawn-mock.js';
import { withShellNodeMajor } from './test/with-shell-node-major.js';
import {
  ensureBetterSqlite3,
  isNodeSqliteCompatible,
  parseSemverMajor,
  probeBetterSqlite3,
  readHostBetterSqlite3Version,
  rebuildBetterSqlite3,
  semverGte,
} from './native-deps.js';

const tempDirs: string[] = [];

function makeRoot(deps: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-deps-'));
  tempDirs.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: deps }),
  );
  fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
  return root;
}

function mockSpawnOk(stdout = 'ok'): void {
  spawnSyncMock.mockReturnValue({
    status: 0,
    stdout,
    stderr: '',
    output: [null, stdout, ''],
    pid: 0,
    signal: null,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  spawnSyncMock.mockReset();
});

describe('parseSemverMajor', () => {
  it('parses semver prefixes', () => {
    expect(parseSemverMajor('^11.10.0')).toBe(11);
    expect(parseSemverMajor('12.10.0')).toBe(12);
    expect(parseSemverMajor('12')).toBe(12);
    expect(parseSemverMajor('0.10.0')).toBe(0);
    expect(parseSemverMajor('12.a.0')).toBe(12);
    expect(parseSemverMajor('bad')).toBe(0);
    expect(parseSemverMajor('')).toBe(0);
  });
});

describe('semverGte', () => {
  it('compares patch versions', () => {
    expect(semverGte('12.10.0', '12.10.0')).toBe(true);
    expect(semverGte('12.9.0', '12.10.0')).toBe(false);
    expect(semverGte('^12.10.0', '12.10.0')).toBe(true);
    expect(semverGte('12.10', '12.10.0')).toBe(true);
    expect(semverGte('12', '12.0.0')).toBe(true);
    expect(semverGte('13.0.0', '12.10.0')).toBe(true);
    expect(semverGte('12.11.0', '12.10.0')).toBe(true);
    expect(semverGte('12.10.0', '12.10.1')).toBe(false);
  });
});

describe('isNodeSqliteCompatible', () => {
  it('flags node 26 with better-sqlite3 below 12.10.0', () => {
    expect(isNodeSqliteCompatible(26, '11.10.0')).toBe(false);
    expect(isNodeSqliteCompatible(26, '12.0.0')).toBe(false);
    expect(isNodeSqliteCompatible(26, '12.9.9')).toBe(false);
    expect(isNodeSqliteCompatible(26, '12.10.0')).toBe(true);
    expect(isNodeSqliteCompatible(26, '^12.10.0')).toBe(true);
    expect(isNodeSqliteCompatible(22, '11.10.0')).toBe(true);
  });
});

describe('readHostBetterSqlite3Version', () => {
  it('reads dependency version from host package.json', () => {
    expect(readHostBetterSqlite3Version(makeRoot({ 'better-sqlite3': '11.10.0' }))).toBe(
      '11.10.0',
    );
  });

  it('returns undefined when package.json is missing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-deps-missing-'));
    tempDirs.push(root);
    expect(readHostBetterSqlite3Version(root)).toBeUndefined();
  });

  it('returns undefined when package.json is malformed', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'package.json'), '{not json');
    expect(readHostBetterSqlite3Version(root)).toBeUndefined();
  });
});

describe('probeBetterSqlite3', () => {
  beforeEach(() => mockSpawnOk());

  it('returns ok when probe succeeds', () => {
    expect(probeBetterSqlite3(makeRoot()).ok).toBe(true);
  });
});

describe('rebuildBetterSqlite3', () => {
  it('returns rebuild output', () => {
    mockSpawnOk();
    const result = rebuildBetterSqlite3(makeRoot());
    expect(result.ok).toBe(true);
    expect(spawnSyncMock).toHaveBeenCalled();
  });
});

describe('ensureBetterSqlite3', () => {
  beforeEach(() => mockSpawnOk());

  it('skips when host has no better-sqlite3', () => {
    expect(ensureBetterSqlite3(makeRoot()).ok).toBe(true);
  });

  it('returns ok when probe succeeds immediately', () => {
    expect(ensureBetterSqlite3(makeRoot({ 'better-sqlite3': '11.10.0' })).ok).toBe(true);
  });

  it('rebuilds when first probe fails and second succeeds', () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 1,
        stdout: 'fail',
        stderr: '',
        output: [null, 'fail', ''],
        pid: 0,
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: '',
        output: [null, '', ''],
        pid: 0,
        signal: null,
      })
      .mockReturnValue({
        status: 0,
        stdout: 'ok',
        stderr: '',
        output: [null, 'ok', ''],
        pid: 0,
        signal: null,
      });

    const result = ensureBetterSqlite3(makeRoot({ 'better-sqlite3': '11.10.0' }));
    expect(result.ok).toBe(true);
    expect(result.rebuilt).toBe(true);
  });

  it('fails when rebuild fails', () => {
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: 'compile error',
      stderr: '',
      output: [null, 'compile error', ''],
      pid: 0,
      signal: null,
    });
    const result = ensureBetterSqlite3(makeRoot({ 'better-sqlite3': '11.10.0' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('better-sqlite3');
  });

  it('fails fast on incompatible node when shell matches project major', () => {
    withShellNodeMajor(26, () => {
      const root = makeRoot({ 'better-sqlite3': '11.10.0' });
      fs.writeFileSync(path.join(root, '.nvmrc'), '26\n');
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: 'fail',
        stderr: '',
        output: [null, 'fail', ''],
        pid: 0,
        signal: null,
      });

      const result = ensureBetterSqlite3(root);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('does not support Node 26');
    });
  });

  it('includes install hint when project node is missing', () => {
    withShellNodeMajor(26, () => {
      const root = makeRoot({ 'better-sqlite3': '11.10.0' });
      vi.stubEnv('NVM_DIR', path.join(root, 'missing-nvm'));
      vi.stubEnv('FNM_DIR', path.join(root, 'missing-fnm'));
      vi.stubEnv('MISE_DATA_DIR', path.join(root, 'missing-mise'));
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: 'fail',
        stderr: '',
        output: [null, 'fail', ''],
        pid: 0,
        signal: null,
      });

      const result = ensureBetterSqlite3(root);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Node 22 is not installed');
    });
  });

  it('fails on win32 when incompatible and no project node', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    withShellNodeMajor(26, () => {
      const root = makeRoot({ 'better-sqlite3': '11.10.0' });
      vi.stubEnv('NVM_DIR', path.join(root, 'missing-nvm'));
      vi.stubEnv('FNM_DIR', path.join(root, 'missing-fnm'));
      vi.stubEnv('MISE_DATA_DIR', path.join(root, 'missing-mise'));
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: 'fail',
        stderr: '',
        output: [null, 'fail', ''],
        pid: 0,
        signal: null,
      });

      const result = ensureBetterSqlite3(root);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('does not support Node 26');
    });
    if (platform) Object.defineProperty(process, 'platform', platform);
  });

  it('uses rebuild output when second probe fails with empty output', () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 1,
        stdout: 'first fail',
        stderr: '',
        output: [null, 'first fail', ''],
        pid: 0,
        signal: null,
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: 'rebuild ok',
        stderr: '',
        output: [null, 'rebuild ok', ''],
        pid: 0,
        signal: null,
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: '',
        output: [null, '', ''],
        pid: 0,
        signal: null,
      });

    const result = ensureBetterSqlite3(makeRoot({ 'better-sqlite3': '11.10.0' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('rebuild ok');
  });

  it('uses first probe output when rebuild fails without output', () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 1,
        stdout: 'first fail',
        stderr: '',
        output: [null, 'first fail', ''],
        pid: 0,
        signal: null,
      })
      .mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: '',
        output: [null, '', ''],
        pid: 0,
        signal: null,
      });

    const result = ensureBetterSqlite3(makeRoot({ 'better-sqlite3': '11.10.0' }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('first fail');
  });

  it('fails with guidance when sqlite error detail is empty', () => {
    withShellNodeMajor(26, () => {
      const root = makeRoot({ 'better-sqlite3': '11.10.0' });
      fs.writeFileSync(path.join(root, '.nvmrc'), '26\n');
      spawnSyncMock.mockReturnValue({
        status: 1,
        stdout: '',
        stderr: '',
        output: [null, '', ''],
        pid: 0,
        signal: null,
      });

      const result = ensureBetterSqlite3(root);
      expect(result.ok).toBe(false);
      expect(result.message).toContain('could not load better-sqlite3');
      expect(result.message?.split('\n').at(-1)).not.toBe('');
    });
  });
});

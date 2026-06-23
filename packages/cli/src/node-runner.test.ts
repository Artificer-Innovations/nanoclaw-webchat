import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSyncMock } from './test/spawn-mock.js';
import { withShellNodeMajor } from './test/with-shell-node-major.js';
import * as nodeRunner from './node-runner.js';
import {
  findNodeBinDirForMajor,
  projectNodeConfigLabel,
  readNodeVersionFile,
  readProjectNodeMajor,
  RECOMMENDED_NODE_MAJOR,
  runUnderProjectNode,
  scaffoldProjectNodeFiles,
  SPAWN_TIMEOUT_MS,
  verifyHostReminder,
} from './node-runner.js';

const tempDirs: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'node-runner-'));
  tempDirs.push(root);
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

describe('readNodeVersionFile', () => {
  it('reads .nvmrc and strips v prefix', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'v22.23.0\n');
    expect(readNodeVersionFile(root)).toBe('22.23.0');
  });

  it('reads .node-version when .nvmrc is absent', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.node-version'), '20.11.0');
    expect(readNodeVersionFile(root)).toBe('20.11.0');
  });

  it('reads .node-version when .nvmrc is empty', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), '\n');
    fs.writeFileSync(path.join(root, '.node-version'), '20.11.0');
    expect(readNodeVersionFile(root)).toBe('20.11.0');
  });

  it('returns undefined when no version file exists', () => {
    expect(readNodeVersionFile(makeRoot())).toBeUndefined();
  });
});

describe('readProjectNodeMajor', () => {
  it('defaults to recommended major', () => {
    expect(readProjectNodeMajor(makeRoot())).toBe(RECOMMENDED_NODE_MAJOR);
  });

  it('parses major from .nvmrc', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), '20\n');
    expect(readProjectNodeMajor(root)).toBe(20);
  });

  it('falls back when version file is not numeric', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'lts\n');
    expect(readProjectNodeMajor(root)).toBe(RECOMMENDED_NODE_MAJOR);
  });

  it('warns on unparseable nvm aliases', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'lts/iron\n');
    const warn = vi.fn();
    expect(readProjectNodeMajor(root, warn)).toBe(RECOMMENDED_NODE_MAJOR);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lts/iron'));
  });

  it('warns via console.warn on unparseable aliases by default', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'lts/hydrogen\n');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readProjectNodeMajor(root, warn)).toBe(RECOMMENDED_NODE_MAJOR);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lts/hydrogen'));
    warn.mockRestore();
  });

  it('stays silent on unparseable aliases when no warn callback is passed', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), 'lts/hydrogen\n');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readProjectNodeMajor(root)).toBe(RECOMMENDED_NODE_MAJOR);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('projectNodeConfigLabel', () => {
  it('prefers .nvmrc over .node-version', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
    fs.writeFileSync(path.join(root, '.node-version'), '20\n');
    expect(projectNodeConfigLabel(root)).toBe('.nvmrc');
  });

  it('uses .node-version when .nvmrc is absent', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.node-version'), '20\n');
    expect(projectNodeConfigLabel(root)).toBe('.node-version');
  });

  it('falls back to default label', () => {
    expect(projectNodeConfigLabel(makeRoot())).toBe('default (Node 22)');
  });
});

describe('verifyHostReminder', () => {
  it('returns reminder when shell and project majors differ', () => {
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      expect(verifyHostReminder(root)).toContain('nvm use');
    });
  });

  it('returns undefined when majors match', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), `${nodeRunner.currentNodeMajor()}\n`);
    expect(verifyHostReminder(root)).toBeUndefined();
  });
});

describe('findNodeBinDirForMajor', () => {
  it('finds nvm node bin directory', () => {
    const root = makeRoot();
    const nvmDir = path.join(root, 'nvm');
    const binDir = path.join(nvmDir, 'versions/node/v22.23.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('NVM_DIR', nvmDir);
    expect(findNodeBinDirForMajor(22)).toBe(binDir);
  });

  it('finds fnm node bin directory', () => {
    const root = makeRoot();
    const fnmDir = path.join(root, 'fnm');
    const binDir = path.join(fnmDir, 'node-versions/v22.1.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('NVM_DIR', path.join(root, 'missing-nvm'));
    vi.stubEnv('FNM_DIR', fnmDir);
    expect(findNodeBinDirForMajor(22)).toBe(binDir);
  });

  it('finds mise node bin directory', () => {
    const root = makeRoot();
    const miseDir = path.join(root, 'mise');
    const binDir = path.join(miseDir, 'installs/node/22.1.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('NVM_DIR', path.join(root, 'missing-nvm'));
    vi.stubEnv('FNM_DIR', path.join(root, 'missing-fnm'));
    vi.stubEnv('MISE_DATA_DIR', miseDir);
    expect(findNodeBinDirForMajor(22)).toBe(binDir);
  });

  it('ignores version dirs without a node binary', () => {
    const root = makeRoot();
    const nvmDir = path.join(root, 'nvm');
    const binDir = path.join(nvmDir, 'versions/node/v22.23.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    vi.stubEnv('NVM_DIR', nvmDir);
    expect(findNodeBinDirForMajor(22)).toBeNull();
  });

  it('finds nvm directories without a v prefix and picks the latest patch', () => {
    const root = makeRoot();
    const nvmDir = path.join(root, 'nvm');
    for (const version of ['22.0.0', '22.1.0']) {
      const binDir = path.join(nvmDir, 'versions/node', version, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'node'), '');
    }
    vi.stubEnv('NVM_DIR', nvmDir);
    expect(findNodeBinDirForMajor(22)).toBe(path.join(nvmDir, 'versions/node/22.1.0/bin'));
  });

  it('returns null when version directory has no matching major', () => {
    const root = makeRoot();
    const miseDir = path.join(root, 'mise');
    const binDir = path.join(miseDir, 'installs/node/20.1.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('NVM_DIR', path.join(root, 'missing-nvm'));
    vi.stubEnv('FNM_DIR', path.join(root, 'missing-fnm'));
    vi.stubEnv('MISE_DATA_DIR', miseDir);
    expect(findNodeBinDirForMajor(22)).toBeNull();
  });

  it('uses default home nvm directory when NVM_DIR is unset', () => {
    const home = makeRoot();
    const nvmDir = path.join(home, '.nvm');
    const binDir = path.join(nvmDir, 'versions/node/v22.23.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('HOME', home);
    vi.stubEnv('NVM_DIR', undefined);

    expect(findNodeBinDirForMajor(22)).toBe(binDir);
  });

  it('uses default fnm directory on macOS when FNM_DIR is unset', () => {
    if (process.platform !== 'darwin') return;
    const home = makeRoot();
    const fnmDir = path.join(home, 'Library', 'Application Support', 'fnm');
    const binDir = path.join(fnmDir, 'node-versions/v22.1.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('HOME', home);
    vi.stubEnv('NVM_DIR', path.join(home, 'missing-nvm'));
    vi.stubEnv('FNM_DIR', undefined);
    expect(findNodeBinDirForMajor(22)).toBe(binDir);
  });

  it('uses default fnm directory on linux when FNM_DIR is unset', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
    const home = makeRoot();
    const fnmDir = path.join(home, '.local/share/fnm');
    const binDir = path.join(fnmDir, 'node-versions/v22.1.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('HOME', home);
    vi.stubEnv('NVM_DIR', path.join(home, 'missing-nvm'));
    vi.stubEnv('FNM_DIR', undefined);
    try {
      expect(findNodeBinDirForMajor(22)).toBe(binDir);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('uses default fnm directory on win32 when FNM_DIR is unset', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const home = makeRoot();
    const fnmDir = path.join(home, '.local/share/fnm');
    const binDir = path.join(fnmDir, 'node-versions/v22.1.0/bin');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'node'), '');
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('NVM_DIR', path.join(home, 'missing-nvm'));
    vi.stubEnv('FNM_DIR', undefined);
    try {
      expect(findNodeBinDirForMajor(22)).toBe(binDir);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('returns null when no version manager install exists', () => {
    vi.stubEnv('NVM_DIR', path.join(makeRoot(), 'missing-nvm'));
    vi.stubEnv('FNM_DIR', path.join(makeRoot(), 'missing-fnm'));
    vi.stubEnv('MISE_DATA_DIR', path.join(makeRoot(), 'missing-mise'));
    expect(findNodeBinDirForMajor(22)).toBeNull();
  });
});

describe('runUnderProjectNode', () => {
  beforeEach(() => mockSpawnOk());

  it('passes spawn timeout to child processes', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), `${nodeRunner.currentNodeMajor()}\n`);
    runUnderProjectNode(root, 'node', ['-v']);
    expect(spawnSyncMock.mock.calls.at(-1)?.[2]?.timeout).toBe(SPAWN_TIMEOUT_MS);
  });

  it('runs directly when shell major matches project major', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), `${nodeRunner.currentNodeMajor()}\n`);
    const result = runUnderProjectNode(root, 'node', ['-v']);
    expect(result.usedProjectNode).toBe(false);
    expect(result.status).toBe(0);
  });

  it('prepends version-manager bin when majors differ', () => {
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      const nvmDir = path.join(root, 'nvm');
      const binDir = path.join(nvmDir, 'versions/node/v22.23.0/bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'node'), '');
      vi.stubEnv('NVM_DIR', nvmDir);

      const result = runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
      expect(result.usedProjectNode).toBe(true);
      expect(result.notice).toContain('Node v22');
      const env = spawnSyncMock.mock.calls.at(-1)?.[2]?.env as NodeJS.ProcessEnv;
      expect(env.PATH?.startsWith(binDir)).toBe(true);
      expect(env.npm_node_execpath).toBe(path.join(binDir, 'node'));
    });
  });

  it('prepends version-manager bin when PATH is unset', () => {
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      const nvmDir = path.join(root, 'nvm');
      const binDir = path.join(nvmDir, 'versions/node/v22.23.0/bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'node'), '');
      vi.stubEnv('NVM_DIR', nvmDir);
      vi.stubEnv('PATH', undefined);

      runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
      const env = spawnSyncMock.mock.calls.at(-1)?.[2]?.env as NodeJS.ProcessEnv;
      expect(env.PATH).toBe(`${binDir}${path.delimiter}`);
    });
  });

  it('does not treat nvm exec stderr as success when status is non-zero', () => {
    if (process.platform === 'win32') return;
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      vi.stubEnv('NVM_DIR', path.join(root, 'empty-nvm'));
      spawnSyncMock
        .mockReturnValueOnce({
          status: 1,
          stdout: '',
          stderr: 'nvm using 22',
          output: [null, '', 'nvm using 22'],
          pid: 0,
          signal: null,
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: 'fallback',
          stderr: '',
          output: [null, 'fallback', ''],
          pid: 0,
          signal: null,
        });

      const result = runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
      expect(result.usedProjectNode).toBe(false);
      expect(result.stdout).toBe('fallback');
    });
  });

  it('falls back to nvm exec on unix when bin dir is missing', () => {
    if (process.platform === 'win32') return;
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      vi.stubEnv('NVM_DIR', path.join(root, 'empty-nvm'));
      spawnSyncMock.mockReturnValueOnce({
        status: 0,
        stdout: 'ok',
        stderr: '',
        output: [null, 'ok', ''],
        pid: 0,
        signal: null,
      });

      const result = runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
      expect(spawnSyncMock.mock.calls[0]?.[0]).toBe('bash');
      expect(result.usedProjectNode).toBe(true);
      expect(result.notice).toContain('nvm exec');
    });
  });

  it('shell-quotes nvm exec args with special characters', () => {
    if (process.platform === 'win32') return;
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      vi.stubEnv('NVM_DIR', path.join(root, 'empty-nvm'));

      runUnderProjectNode(root, 'node', ['-e', "console.log('hi')"]);
      const bashArgs = spawnSyncMock.mock.calls[0]?.[1] as string[];
      expect(bashArgs[1]).toContain("nvm exec 22 node -e");
      expect(bashArgs[1]).toMatch(/'console\.log\('\\''hi'\\''\)'/);
    });
  });

  it('uses default home nvm script when NVM_DIR is unset for nvm exec', () => {
    if (process.platform === 'win32') return;
    const home = makeRoot();
    const nvmDir = path.join(home, '.nvm');
    fs.mkdirSync(nvmDir, { recursive: true });
    fs.writeFileSync(path.join(nvmDir, 'nvm.sh'), '# stub');
    vi.stubEnv('HOME', home);
    vi.stubEnv('NVM_DIR', undefined);
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      spawnSyncMock.mockReturnValueOnce({
        status: 0,
        stdout: null as unknown as string,
        stderr: null as unknown as string,
        output: [null, null, null],
        pid: 0,
        signal: null,
      });

      const result = runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
      expect(spawnSyncMock.mock.calls[0]?.[0]).toBe('bash');
      expect(String(spawnSyncMock.mock.calls[0]?.[1]?.[1])).toContain(path.join(home, '.nvm', 'nvm.sh'));
      expect(result.usedProjectNode).toBe(true);
    });
  });

  it('accepts nvm exec success with empty streams', () => {
    if (process.platform === 'win32') return;
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      vi.stubEnv('NVM_DIR', path.join(root, 'empty-nvm'));
      spawnSyncMock.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: '',
        output: [null, '', ''],
        pid: 0,
        signal: null,
      });

      const result = runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
      expect(result.usedProjectNode).toBe(true);
      expect(result.notice).toContain('nvm exec');
    });
  });

  it('falls back to direct spawn when nvm exec produces no output', () => {
    if (process.platform === 'win32') return;
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      vi.stubEnv('NVM_DIR', path.join(root, 'empty-nvm'));

      spawnSyncMock
        .mockReturnValueOnce({
          status: 1,
          stdout: '',
          stderr: '',
          output: [null, '', ''],
          pid: 0,
          signal: null,
        })
        .mockReturnValueOnce({
          status: 0,
          stdout: 'fallback',
          stderr: '',
          output: [null, 'fallback', ''],
          pid: 0,
          signal: null,
        });

      const result = runUnderProjectNode(root, 'node', ['-v']);
      expect(result.stdout).toBe('fallback');
      expect(result.usedProjectNode).toBe(false);
    });
  });

  it('uses shell spawn on win32 when shell major matches project major', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), `${nodeRunner.currentNodeMajor()}\n`);
    try {
      runUnderProjectNode(root, 'node', ['-v']);
      expect(spawnSyncMock.mock.calls.at(-1)?.[2]?.shell).toBe(true);
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
  });

  it('falls back to direct spawn on win32 when bin dir is missing', () => {
    if (process.platform !== 'win32') return;
    withShellNodeMajor(26, () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
      vi.stubEnv('NVM_DIR', path.join(root, 'empty-nvm'));

      const result = runUnderProjectNode(root, 'node', ['-v']);
      expect(result.usedProjectNode).toBe(false);
      expect(spawnSyncMock.mock.calls[0]?.[0]).toBe('node');
    });
  });
});

describe('scaffoldProjectNodeFiles', () => {
  it('creates .nvmrc and .npmrc when missing', () => {
    const root = makeRoot();
    const result = scaffoldProjectNodeFiles(root);
    expect(result.nvmrcCreated).toBe(true);
    expect(result.npmrcUpdated).toBe(true);
    expect(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8')).toBe('22\n');
    expect(fs.readFileSync(path.join(root, '.npmrc'), 'utf8')).toContain(
      'onlyBuiltDependencies[]=better-sqlite3',
    );
  });

  it('does not overwrite existing .nvmrc', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), '20\n');
    const result = scaffoldProjectNodeFiles(root);
    expect(result.nvmrcCreated).toBe(false);
    expect(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8')).toBe('20\n');
  });

  it('appends npmrc marker when file exists without marker', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
    fs.writeFileSync(path.join(root, '.npmrc'), 'minReleaseAge=3d');
    const result = scaffoldProjectNodeFiles(root);
    expect(result.npmrcUpdated).toBe(true);
    const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
    expect(npmrc).toContain('minReleaseAge=3d');
    expect(npmrc).toContain('onlyBuiltDependencies[]=better-sqlite3');
  });

  it('appends npmrc marker to an empty file', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.npmrc'), '');
    const result = scaffoldProjectNodeFiles(root);
    expect(result.npmrcUpdated).toBe(true);
    expect(fs.readFileSync(path.join(root, '.npmrc'), 'utf8')).toContain(
      'onlyBuiltDependencies[]=better-sqlite3',
    );
  });

  it('appends npmrc marker after existing content with trailing newline', () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, '.npmrc'), 'minReleaseAge=3d\n');
    const result = scaffoldProjectNodeFiles(root);
    expect(result.npmrcUpdated).toBe(true);
    const npmrc = fs.readFileSync(path.join(root, '.npmrc'), 'utf8');
    expect(npmrc.startsWith('minReleaseAge=3d\n')).toBe(true);
  });
});

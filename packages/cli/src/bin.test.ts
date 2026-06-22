import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSyncMock } from './test/spawn-mock.js';
import { parseArgs, runCommand, main, isCliEntry } from './bin.js';
import { printInstallNextSteps, runInstall, runUninstall, runUpgrade, runVerify } from './install.js';
import {
  appendBarrelImport,
  copyAdapterFiles,
  insertWebchatBootBlock,
  findWebchatBootInsertIndex,
  hasWebchatBootBlock,
  removeAdapterFiles,
  removeBarrelImport,
  removeEnvVars,
  removeWebchatBootBlock,
  scaffoldEnv,
} from './patch.js';
import { findNanoclawRoot, packageRoot, resourcesDir } from './paths.js';

const tempDirs: string[] = [];

function makeNanoclawFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-cli-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'src/channels'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/channels/index.ts'), "import './telegram.js';\n");
  fs.writeFileSync(
    path.join(root, 'src/index.ts'),
    'async function main() {\n  await runMigrations(db);\n  await initChannelAdapters(config);\n}\n',
  );
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
  spawnSyncMock.mockReset();
});

beforeEach(() => {
  spawnSyncMock.mockReset();
});

describe('parseArgs', () => {
  it('defaults to help when no command', () => {
    expect(parseArgs(['node', 'bin.js'])).toEqual({ command: 'help' });
  });

  it('parses command and --path', () => {
    expect(parseArgs(['node', 'bin.js', 'install', '--path', '/tmp/nanoclaw'])).toEqual({
      command: 'install',
      path: '/tmp/nanoclaw',
    });
  });

  it('ignores --path without a value', () => {
    expect(parseArgs(['node', 'bin.js', 'install', '--path'])).toEqual({
      command: 'install',
    });
  });
});

describe('runCommand', () => {
  it('prints help for unknown command', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'nope'])).toBe(1);
    expect(runCommand(['node', 'bin.js', 'help'])).toBe(0);
    log.mockRestore();
  });

  it('runs install against --path fixture', () => {
    const root = makeNanoclawFixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'install', '--path', root])).toBe(0);
    log.mockRestore();
  });

  it('runs sync-skill, verify, upgrade, and uninstall', () => {
    const root = makeNanoclawFixture();
    runCommand(['node', 'bin.js', 'install', '--path', root]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'sync-skill', '--path', root])).toBe(0);
    log.mockRestore();

    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      output: [null, 'ok', ''],
      pid: 0,
      signal: null,
    });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const verifyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'verify', '--path', root])).toBe(0);
    write.mockRestore();
    verifyLog.mockRestore();

    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: '',
      stderr: 'fail',
      output: [null, '', 'fail'],
      pid: 0,
      signal: null,
    });
    expect(runCommand(['node', 'bin.js', 'verify', '--path', root])).toBe(1);

    const upgradeLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'upgrade', '--path', root])).toBe(0);
    upgradeLog.mockRestore();

    const uninstallLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'uninstall', '--path', root])).toBe(0);
    uninstallLog.mockRestore();
  });

  it('sync-skill without --path uses cwd', () => {
    const root = makeNanoclawFixture();
    const cwd = process.cwd();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.chdir(root);
    try {
      expect(runCommand(['node', 'bin.js', 'sync-skill'])).toBe(0);
    } finally {
      process.chdir(cwd);
      log.mockRestore();
    }
  });

  it('returns 1 when command throws', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(runCommand(['node', 'bin.js', 'sync-skill', '--path', '/nonexistent/path'])).toBe(1);
    err.mockRestore();
  });

  it('main delegates to runCommand', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    process.argv = ['node', 'bin.js', 'help'];
    main();
    expect(exit).toHaveBeenCalledWith(0);
    exit.mockRestore();
  });

  it('isCliEntry matches argv entry path', () => {
    expect(isCliEntry('/tmp/bin.js', ['node'])).toBe(false);
    expect(isCliEntry('/tmp/bin.js', ['node', '/tmp/bin.js'])).toBe(true);
    expect(isCliEntry('/tmp/bin.js', ['node', '/other.js'])).toBe(false);
  });

  it('reports non-Error throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    spawnSyncMock.mockImplementation(() => {
      throw 'boom';
    });
    expect(runCommand(['node', 'bin.js', 'verify', '--path', '/tmp'])).toBe(1);
  });
});

describe('runVerify', () => {
  it('wraps vitest spawn result', () => {
    const root = makeNanoclawFixture();
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'tests passed',
      stderr: '',
      output: [null, 'tests passed', ''],
      pid: 0,
      signal: null,
    });
    expect(runVerify(root).ok).toBe(true);
  });

  it('handles null stdout and stderr from spawn', () => {
    const root = makeNanoclawFixture();
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: null,
      stderr: null,
      output: [null, null, null],
      pid: 0,
      signal: null,
    });
    expect(runVerify(root).output).toBe('');
  });

  it('uses cwd when path omitted', () => {
    const root = makeNanoclawFixture();
    const cwd = process.cwd();
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '',
      stderr: '',
      output: [null, '', ''],
      pid: 0,
      signal: null,
    });
    process.chdir(root);
    try {
      expect(fs.realpathSync(runVerify().root)).toBe(fs.realpathSync(root));
    } finally {
      process.chdir(cwd);
    }
  });
});

describe('patch edge cases', () => {
  it('throws when adapter resource is missing', () => {
    const root = makeNanoclawFixture();
    expect(() => copyAdapterFiles(root, path.join(root, 'missing-resources'))).toThrow(
      'Missing adapter resource',
    );
  });

  it('throws when initChannelAdapters marker is missing', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, 'src/index.ts'), 'async function main() {}\n');
    expect(() => insertWebchatBootBlock(root)).toThrow('initChannelAdapters');
  });

  it('insertWebchatBootBlock inserts before await initChannelAdapters without corrupting await', () => {
    const root = makeNanoclawFixture();
    insertWebchatBootBlock(root);
    const content = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    expect(content).toContain('await startWebChat();');
    expect(content).not.toMatch(/await\s+const \{ startWebChat \}/);
    expect(content).toContain('await initChannelAdapters(config);');
  });

  it('findWebchatBootInsertIndex prefers awaited channel init call', () => {
    const content = 'async function main() {\n  await initChannelAdapters(config);\n}\n';
    const match = content.match(/^  await initChannelAdapters\(/m);
    expect(findWebchatBootInsertIndex(content)).toBe(match?.index);
  });

  it('removeWebchatBootBlock restores await initChannelAdapters', () => {
    const root = makeNanoclawFixture();
    insertWebchatBootBlock(root);
    expect(removeWebchatBootBlock(root)).toBe(true);
    const content = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
    expect(content).toContain('await initChannelAdapters(config);');
    expect(content).not.toContain('startWebChat()');
  });

  it('removeWebchatBootBlock handles alternate formatting', () => {
    const root = makeNanoclawFixture();
    const block = `  const { startWebChat } = await import('./webchat-boot.js');
  await startWebChat();`;
    fs.writeFileSync(
      path.join(root, 'src/index.ts'),
      `async function main() {\n${block}\n  initChannelAdapters(config);\n}\n`,
    );
    expect(removeWebchatBootBlock(root)).toBe(true);
  });

  it('removeWebchatBootBlock returns false when block absent', () => {
    const root = makeNanoclawFixture();
    expect(removeWebchatBootBlock(root)).toBe(false);
  });

  it('removeEnvVars on missing .env returns empty list', () => {
    const root = makeNanoclawFixture();
    expect(removeEnvVars(root)).toEqual([]);
  });

  it('scaffoldEnv skips existing keys only', () => {
    const root = makeNanoclawFixture();
    scaffoldEnv(root);
    const second = scaffoldEnv(root);
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it('appendBarrelImport handles file without trailing newline', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, 'src/channels/index.ts'), "import './telegram.js';");
    expect(appendBarrelImport(root)).toBe(true);
  });

  it('removeEnvVars strips WEBCHAT keys from .env', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, '.env'), 'WEBCHAT_ENABLED=true\nOTHER=1\n');
    expect(removeEnvVars(root)).toEqual(['WEBCHAT_ENABLED']);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8')).toContain('OTHER=1');
  });

  it('removeEnvVars preserves custom WEBCHAT_* keys not scaffolded by install', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(
      path.join(root, '.env'),
      'WEBCHAT_ENABLED=true\nWEBCHAT_TEAM_FOLDER=dm-with-brad\nOTHER=1\n',
    );
    expect(removeEnvVars(root)).toEqual(['WEBCHAT_ENABLED']);
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    expect(env).toContain('WEBCHAT_TEAM_FOLDER=dm-with-brad');
    expect(env).toContain('OTHER=1');
  });

  it('removeBarrelImport preserves trailing newline', () => {
    const root = makeNanoclawFixture();
    appendBarrelImport(root);
    expect(removeBarrelImport(root)).toBe(true);
    expect(fs.readFileSync(path.join(root, 'src/channels/index.ts'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('findWebchatBootInsertIndex matches tab-indented initChannelAdapters', () => {
    const content = 'async function main() {\n\tawait initChannelAdapters(config);\n}\n';
    expect(findWebchatBootInsertIndex(content)).toBeGreaterThanOrEqual(0);
  });

  it('scaffoldEnv makes no writes when all keys already exist', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(
      path.join(root, '.env'),
      'WEBCHAT_ENABLED=true\nWEBCHAT_PORT=3200\nWEBCHAT_SECRET=abc\n',
    );
    const result = scaffoldEnv(root);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(3);
  });

  it('removeBarrelImport returns false when import absent', () => {
    const root = makeNanoclawFixture();
    expect(removeBarrelImport(root)).toBe(false);
  });

  it('scaffoldEnv appends newline when joined body lacks one', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, '.env'), 'EXISTING=1');
    scaffoldEnv(root);
    expect(fs.readFileSync(path.join(root, '.env'), 'utf8').endsWith('\n')).toBe(true);
  });

  it('scaffoldEnv keeps trailing newline when body already has one', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, '.env'), 'EXISTING=1\n');
    scaffoldEnv(root);
    const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
    expect(env.startsWith('EXISTING=1\n')).toBe(true);
    expect(env.endsWith('\n')).toBe(true);
  });

  it('removeAdapterFiles removes only existing files', () => {
    const root = makeNanoclawFixture();
    copyAdapterFiles(root, resourcesDir());
    fs.unlinkSync(path.join(root, 'src/channels/web.ts'));
    expect(removeAdapterFiles(root)).toHaveLength(13);
  });
});

describe('paths edge cases', () => {
  it('findNanoclawRoot throws when not found', () => {
    expect(() => findNanoclawRoot(os.tmpdir())).toThrow('NanoClaw root not found');
  });

  it('packageRoot resolves monorepo root', () => {
    expect(fs.existsSync(path.join(packageRoot(), 'packages/adapter/src/web.ts'))).toBe(true);
  });

  it('resourcesDir points at adapter source in monorepo', () => {
    expect(resourcesDir()).toMatch(/packages[/\\]adapter[/\\]src$/);
    expect(fs.existsSync(path.join(resourcesDir(), 'web.ts'))).toBe(true);
  });

  it('packageRoot resolves via package.json name when resources missing', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-root-'));
    tempDirs.push(temp);
    fs.writeFileSync(
      path.join(temp, 'package.json'),
      JSON.stringify({ name: 'nanoclaw-webchat' }),
    );
    expect(packageRoot(temp)).toBe(temp);
  });
});

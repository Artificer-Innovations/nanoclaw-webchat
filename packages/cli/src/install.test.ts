import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printInstallNextSteps, runInstall, runUninstall, runUpgrade, runVerify } from './install.js';
import * as nativeDeps from './native-deps.js';
import * as nodeRunner from './node-runner.js';
import { spawnSyncMock } from './test/spawn-mock.js';
import { ADAPTER_COPY_RULES, resourcesDir, skillDir } from './paths.js';

const tempDirs: string[] = [];

function makeNanoclawFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-install-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'src/channels'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/channels/index.ts'), "import './telegram.js';\n");
  fs.writeFileSync(
    path.join(root, 'src/index.ts'),
    'async function main() {\n  await runMigrations(db);\n  initChannelAdapters(config);\n}\n',
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    `${JSON.stringify({ name: 'nanoclaw-host-test', dependencies: {}, devDependencies: {} }, null, 2)}\n`,
  );
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.spyOn(nodeRunner, 'runUnderProjectNode').mockReturnValue({
    status: 0,
    stdout: '',
    stderr: '',
    usedProjectNode: false,
  });
});

describe('install', () => {
  it('runInstall reports failed pnpm install when host dependencies were added', () => {
    const root = makeNanoclawFixture();
    vi.mocked(nodeRunner.runUnderProjectNode).mockReturnValueOnce({
      status: 1,
      stdout: 'install failed',
      stderr: 'network error',
      usedProjectNode: false,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = runInstall(root);
    expect(result.dependenciesInstalled).toBe(false);
    expect(warn.mock.calls.some((call) => String(call[0]).includes('pnpm install failed'))).toBe(true);
    expect(warn.mock.calls.some((call) => String(call[0]).includes('network error'))).toBe(true);
    warn.mockRestore();
    log.mockRestore();
  });

  it('runInstall warns without detail when pnpm install fails silently', () => {
    const root = makeNanoclawFixture();
    vi.mocked(nodeRunner.runUnderProjectNode).mockReturnValueOnce({
      status: null,
      stdout: '',
      stderr: '',
      usedProjectNode: false,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(runInstall(root).dependenciesInstalled).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('unknown');
    warn.mockRestore();
    log.mockRestore();
  });

  it('runInstall copies adapter, patches host, and scaffolds node config', () => {
    const root = makeNanoclawFixture();
    const result = runInstall(root);
    expect(result.copied).toHaveLength(ADAPTER_COPY_RULES.length);
    expect(result.dependenciesAdded).toEqual(['busboy', '@types/busboy']);
    expect(result.dependenciesInstalled).toBe(true);
    expect(nodeRunner.runUnderProjectNode).toHaveBeenCalledWith(root, 'pnpm', ['install']);
    expect(result.barrelPatched).toBe(true);
    expect(result.bootPatched).toBe(true);
    expect(result.env.created.length).toBeGreaterThan(0);
    expect(result.nvmrcCreated).toBe(true);
    expect(result.npmrcUpdated).toBe(true);
    expect(fs.existsSync(path.join(root, '.nvmrc'))).toBe(true);
    expect(fs.readFileSync(path.join(root, '.npmrc'), 'utf8')).toContain(
      'onlyBuiltDependencies[]=better-sqlite3',
    );
  });

  it('runInstall without path uses cwd when cwd is nanoclaw root', () => {
    const root = makeNanoclawFixture();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const result = runInstall();
      expect(fs.realpathSync(result.root)).toBe(fs.realpathSync(root));
    } finally {
      process.chdir(cwd);
    }
  });

  it('runUpgrade syncs skill and reinstalls adapter', () => {
    const root = makeNanoclawFixture();
    fs.mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
    const result = runUpgrade(root);
    expect(result.skillPath).toBe(path.join(root, '.claude/skills/add-webchat'));
    expect(fs.existsSync(path.join(result.skillPath, 'SKILL.md'))).toBe(true);
  });

  it('runUninstall removes adapter artifacts', () => {
    const root = makeNanoclawFixture();
    runInstall(root);
    const result = runUninstall(root);
    expect(result.removedFiles).toHaveLength(ADAPTER_COPY_RULES.length);
    expect(result.barrelRemoved).toBe(true);
    expect(result.bootRemoved).toBe(true);
  });

  it('runUninstall without path uses cwd', () => {
    const root = makeNanoclawFixture();
    runInstall(root);
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(fs.realpathSync(runUninstall().root)).toBe(fs.realpathSync(root));
    } finally {
      process.chdir(cwd);
    }
  });

  it('runUpgrade without path uses cwd', () => {
    const root = makeNanoclawFixture();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(fs.realpathSync(runUpgrade().root)).toBe(fs.realpathSync(root));
    } finally {
      process.chdir(cwd);
    }
  });

  it('printInstallNextSteps logs installed host dependencies', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/tmp/x',
      copied: ['a'],
      dependenciesAdded: ['busboy'],
      dependenciesInstalled: true,
      barrelPatched: false,
      bootPatched: false,
      env: { created: [], skipped: [] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('Installed host dependencies'))).toBe(true);
    log.mockRestore();
  });

  it('printInstallNextSteps warns when host dependencies were not installed', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/tmp/x',
      copied: ['a'],
      dependenciesAdded: ['busboy'],
      dependenciesInstalled: false,
      barrelPatched: false,
      bootPatched: false,
      env: { created: [], skipped: [] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('run pnpm install'))).toBe(true);
    log.mockRestore();
  });

  it('printInstallNextSteps omits env line when nothing created', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/tmp/x',
      copied: ['a'],
      dependenciesAdded: [],
      dependenciesInstalled: true,
      barrelPatched: false,
      bootPatched: false,
      env: { created: [], skipped: ['WEBCHAT_ENABLED'] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('Added .env'))).toBe(false);
    log.mockRestore();
  });

  it('printInstallNextSteps mentions file: link refresh when host uses local package', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { 'nanoclaw-webchat': 'file:../nanoclaw-webchat' },
      }),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root,
      copied: ['a'],
      dependenciesAdded: [],
      dependenciesInstalled: true,
      barrelPatched: true,
      bootPatched: true,
      env: { created: [], skipped: [] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('file: link'))).toBe(true);
    log.mockRestore();
  });

  it('printInstallNextSteps skips node note when shell matches project', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, '.nvmrc'), `${process.version.slice(1).split('.')[0]}\n`);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root,
      copied: ['a'],
      dependenciesAdded: [],
      dependenciesInstalled: true,
      barrelPatched: true,
      bootPatched: true,
      env: { created: [], skipped: [] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('targets Node'))).toBe(false);
    log.mockRestore();
  });

  it('printInstallNextSteps skips file: hint when host package.json is missing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/nonexistent/nanoclaw-root',
      copied: ['a'],
      dependenciesAdded: [],
      dependenciesInstalled: true,
      barrelPatched: true,
      bootPatched: true,
      env: { created: [], skipped: [] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('file: link'))).toBe(false);
    log.mockRestore();
  });

  it('printInstallNextSteps mentions node version mismatch', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, '.nvmrc'), '99\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root,
      copied: ['a'],
      dependenciesAdded: [],
      dependenciesInstalled: true,
      barrelPatched: true,
      bootPatched: true,
      env: { created: [], skipped: [] },
      version: '0.1.0',
      nvmrcCreated: false,
      npmrcUpdated: false,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('targets Node 99'))).toBe(true);
    log.mockRestore();
  });

  it('printInstallNextSteps logs scaffold hints when created', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/tmp/x',
      copied: ['a'],
      dependenciesAdded: [],
      dependenciesInstalled: true,
      barrelPatched: false,
      bootPatched: false,
      env: { created: ['WEBCHAT_ENABLED'], skipped: [] },
      version: '0.1.3',
      nvmrcCreated: true,
      npmrcUpdated: true,
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('Added .nvmrc'))).toBe(true);
    expect(log.mock.calls.some((call) => String(call[0]).includes('Updated .npmrc'))).toBe(true);
    log.mockRestore();
  });

  it('runVerify returns empty output when preflight fails without message', () => {
    const root = makeNanoclawFixture();
    vi.spyOn(nativeDeps, 'ensureBetterSqlite3').mockReturnValue({ ok: false });
    expect(runVerify(root)).toEqual({
      root,
      ok: false,
      output: '',
    });
  });

  it('runVerify returns early when better-sqlite3 preflight fails without notice', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ dependencies: { 'better-sqlite3': '11.10.0' } }),
    );
    fs.writeFileSync(path.join(root, '.nvmrc'), '26\n');
    const descriptor = Object.getOwnPropertyDescriptor(process, 'version');
    Object.defineProperty(process, 'version', { configurable: true, value: 'v26.0.0' });
    spawnSyncMock.mockReturnValue({
      status: 1,
      stdout: 'bindings missing',
      stderr: '',
      output: [null, 'bindings missing', ''],
      pid: 0,
      signal: null,
    });
    try {
      const result = runVerify(root);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('better-sqlite3');
      expect(result.notice).toBeUndefined();
    } finally {
      if (descriptor) Object.defineProperty(process, 'version', descriptor);
    }
  });

  it('runVerify includes hostReminder on success when shell differs from project', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(path.join(root, '.nvmrc'), '22\n');
    const descriptor = Object.getOwnPropertyDescriptor(process, 'version');
    Object.defineProperty(process, 'version', { configurable: true, value: 'v26.0.0' });
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: 'ok',
      stderr: '',
      output: [null, 'ok', ''],
      pid: 0,
      signal: null,
    });
    try {
      const result = runVerify(root);
      expect(result.ok).toBe(true);
      expect(result.hostReminder).toContain('nvm use');
    } finally {
      if (descriptor) Object.defineProperty(process, 'version', descriptor);
    }
  });
});

describe('fixture dirs', () => {
  it('skill and resources directories exist', () => {
    expect(fs.existsSync(resourcesDir())).toBe(true);
    expect(fs.existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(true);
  });
});

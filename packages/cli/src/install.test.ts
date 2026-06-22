import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printInstallNextSteps, runInstall, runUninstall, runUpgrade } from './install.js';
import { syncSkillToFork } from './patch.js';
import { resourcesDir, skillDir } from './paths.js';

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
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('install', () => {
  it('runInstall copies adapter and patches host', () => {
    const root = makeNanoclawFixture();
    const result = runInstall(root);
    expect(result.copied).toHaveLength(14);
    expect(result.barrelPatched).toBe(true);
    expect(result.bootPatched).toBe(true);
    expect(result.env.created.length).toBeGreaterThan(0);
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

  it('syncSkillToFork copies nested skill directories', () => {
    const root = makeNanoclawFixture();
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

  it('runUninstall removes adapter artifacts', () => {
    const root = makeNanoclawFixture();
    runInstall(root);
    const result = runUninstall(root);
    expect(result.removedFiles).toHaveLength(14);
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

  it('printInstallNextSteps omits env line when nothing created', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/tmp/x',
      copied: ['a'],
      barrelPatched: false,
      bootPatched: false,
      env: { created: [], skipped: ['WEBCHAT_ENABLED'] },
      version: '0.2.0',
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('Added .env'))).toBe(false);
    log.mockRestore();
  });

  it('printInstallNextSteps mentions file: link refresh when host uses local package', () => {
    const root = makeNanoclawFixture();
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        dependencies: { '@artificer-innovations/nanoclaw-webchat': 'file:../nanoclaw-webchat' },
      }),
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root,
      copied: ['a'],
      barrelPatched: true,
      bootPatched: true,
      env: { created: [], skipped: [] },
      version: '0.2.0',
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('file: link'))).toBe(true);
    log.mockRestore();
  });

  it('printInstallNextSteps skips file: hint when host package.json is missing', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printInstallNextSteps({
      root: '/nonexistent/nanoclaw-root',
      copied: ['a'],
      barrelPatched: true,
      bootPatched: true,
      env: { created: [], skipped: [] },
      version: '0.2.0',
    });
    expect(log.mock.calls.some((call) => String(call[0]).includes('file: link'))).toBe(false);
    log.mockRestore();
  });
});

describe('fixture dirs', () => {
  it('skill and resources directories exist', () => {
    expect(fs.existsSync(resourcesDir())).toBe(true);
    expect(fs.existsSync(path.join(skillDir(), 'SKILL.md'))).toBe(true);
  });
});

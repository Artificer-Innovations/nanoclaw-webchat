#!/usr/bin/env node
/**
 * Run adapter tests in a host fixture context (adapter imports host modules).
 * Usage: node scripts/run-adapter-coverage.mjs [--coverage]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webchatRoot = path.resolve(__dirname, '..');
const bundledFixture = path.join(webchatRoot, 'test/fixtures/nanoclaw-host');
const withCoverage = process.argv.includes('--coverage');

const ADAPTER_TESTS = [
  'src/channels/web-registration.test.ts',
  'src/channels/web.test.ts',
  'src/webchat-sync.test.ts',
  'src/webchat-wiring.test.ts',
  'src/webchat-store.test.ts',
  'src/webchat-routing.test.ts',
  'src/webchat-mentions.test.ts',
];

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyFixture(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`),
  });
}

let nanoclawRoot = process.env.NANOCLAW_ROOT;
let tempDir = null;

if (!nanoclawRoot) {
  if (!fs.existsSync(path.join(bundledFixture, 'src/index.ts'))) {
    console.error(
      `Bundled fixture missing at ${bundledFixture}. Run: node scripts/prepare-host-fixture.mjs`,
    );
    process.exit(1);
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nanoclaw-webchat-adapter-'));
  copyFixture(bundledFixture, tempDir);
  nanoclawRoot = tempDir;
}

console.log(`Adapter tests target: ${nanoclawRoot}`);

const fixturePnpm = (args) =>
  run('pnpm', ['--ignore-workspace', ...args], { cwd: nanoclawRoot });

try {
  if (!process.env.NANOCLAW_ROOT) {
    run('pnpm', ['run', 'build'], { cwd: webchatRoot });
  }

  fixturePnpm(['install']);
  fixturePnpm(['rebuild', 'better-sqlite3']);

  if (!process.env.NANOCLAW_ROOT) {
    fixturePnpm(['add', `file:${webchatRoot}`, 'ws@8.18.3']);
    fixturePnpm(['add', '-D', '@types/ws@8.18.1']);
    const cliBin = path.join(webchatRoot, 'dist/cli/bin.js');
    run('node', [cliBin, 'install', '--path', nanoclawRoot]);
  }

  const vitestArgs = ['--ignore-workspace', 'exec', 'vitest', 'run', ...ADAPTER_TESTS];
  if (withCoverage) {
    vitestArgs.splice(4, 0, '--coverage');
  }

  run('pnpm', vitestArgs, { cwd: nanoclawRoot });

  console.log(withCoverage ? 'Adapter coverage passed.' : 'Adapter tests passed.');
} finally {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

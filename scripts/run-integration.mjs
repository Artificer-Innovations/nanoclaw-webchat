#!/usr/bin/env node
/**
 * Full-stack integration: install CLI into a NanoClaw fork and run adapter tests.
 *
 * Usage:
 *   NANOCLAW_ROOT=/path/to/nanoclaw-v2 node scripts/run-integration.mjs
 *
 * Defaults to ../nanoclaw-v2 when present.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webchatRoot = path.resolve(__dirname, '..');

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

const nanoclawRoot =
  process.env.NANOCLAW_ROOT ??
  (fs.existsSync(path.join(webchatRoot, '../nanoclaw-v2'))
    ? path.join(webchatRoot, '../nanoclaw-v2')
    : null);

if (!nanoclawRoot || !fs.existsSync(path.join(nanoclawRoot, 'src/index.ts'))) {
  console.error(
    'Integration fixture not found. Set NANOCLAW_ROOT to a NanoClaw fork (e.g. ../nanoclaw-v2).',
  );
  process.exit(1);
}

console.log(`Integration target: ${nanoclawRoot}`);

run('pnpm', ['run', 'build'], { cwd: webchatRoot });
run('pnpm', ['add', `file:${webchatRoot}`, 'ws@8.18.3'], { cwd: nanoclawRoot });
run('pnpm', ['add', '-D', '@types/ws@8.18.1'], { cwd: nanoclawRoot });
run('pnpm', ['exec', 'nanoclaw-webchat', 'install', '--path', nanoclawRoot], {
  cwd: nanoclawRoot,
});
run('pnpm', ['run', 'build'], { cwd: nanoclawRoot });
run(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    'src/channels/web-registration.test.ts',
    'src/channels/web.test.ts',
    'src/webchat-sync.test.ts',
    'src/webchat-wiring.test.ts',
  ],
  { cwd: nanoclawRoot },
);

const smoke = path.join(nanoclawRoot, 'scripts/webchat-smoke.ts');
if (fs.existsSync(smoke)) {
  run('pnpm', ['exec', 'tsx', smoke], { cwd: nanoclawRoot });
} else {
  console.log('Skipping webchat-smoke.ts (not present in fixture)');
}

console.log('Integration passed.');

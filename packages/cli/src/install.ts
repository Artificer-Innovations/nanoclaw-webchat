import fs from 'node:fs';
import path from 'node:path';
import { ensureBetterSqlite3 } from './native-deps.js';
import {
  appendBarrelImport,
  copyAdapterFiles,
  insertWebchatBootBlock,
  removeAdapterFiles,
  removeBarrelImport,
  removeEnvVars,
  removeWebchatBootBlock,
  scaffoldEnv,
  syncSkillToFork,
} from './patch.js';
import { readProjectNodeMajor, runUnderProjectNode, scaffoldProjectNodeFiles } from './node-runner.js';
import { findNanoclawRoot, readPackageVersion, VERIFY_TESTS } from './paths.js';

export interface InstallResult {
  root: string;
  copied: string[];
  barrelPatched: boolean;
  bootPatched: boolean;
  env: { created: string[]; skipped: string[] };
  version: string;
  nvmrcCreated: boolean;
  npmrcUpdated: boolean;
}

export function runInstall(root?: string): InstallResult {
  const nanoclawRoot = root ?? findNanoclawRoot();
  console.log(`Detected NanoClaw root: ${nanoclawRoot}`);
  const copied = copyAdapterFiles(nanoclawRoot);
  const barrelPatched = appendBarrelImport(nanoclawRoot);
  const bootPatched = insertWebchatBootBlock(nanoclawRoot);
  const env = scaffoldEnv(nanoclawRoot);
  const { nvmrcCreated, npmrcUpdated } = scaffoldProjectNodeFiles(nanoclawRoot);
  return {
    root: nanoclawRoot,
    copied,
    barrelPatched,
    bootPatched,
    env,
    version: readPackageVersion(),
    nvmrcCreated,
    npmrcUpdated,
  };
}

export function runUpgrade(root?: string): InstallResult & { skillPath: string } {
  const skillPath = syncSkillToFork(root ?? findNanoclawRoot());
  return { skillPath, ...runInstall(root) };
}

export function runUninstall(root?: string): {
  root: string;
  removedFiles: string[];
  barrelRemoved: boolean;
  bootRemoved: boolean;
  envRemoved: string[];
} {
  const nanoclawRoot = root ?? findNanoclawRoot();
  const removedFiles = removeAdapterFiles(nanoclawRoot);
  const barrelRemoved = removeBarrelImport(nanoclawRoot);
  const bootRemoved = removeWebchatBootBlock(nanoclawRoot);
  const envRemoved = removeEnvVars(nanoclawRoot);
  return { root: nanoclawRoot, removedFiles, barrelRemoved, bootRemoved, envRemoved };
}

export function runVerify(root?: string): {
  root: string;
  ok: boolean;
  output: string;
  notice?: string;
} {
  const nanoclawRoot = root ?? findNanoclawRoot();
  const prep = ensureBetterSqlite3(nanoclawRoot);
  if (!prep.ok) {
    const chunks = [prep.notice, prep.message].filter(Boolean);
    return { root: nanoclawRoot, ok: false, output: chunks.join('\n\n'), notice: prep.notice };
  }

  const result = runUnderProjectNode(nanoclawRoot, 'pnpm', ['exec', 'vitest', 'run', ...VERIFY_TESTS]);
  const output = `${result.stdout}${result.stderr}`.trim();
  const notice = prep.notice ?? result.notice;
  return {
    root: nanoclawRoot,
    ok: result.status === 0,
    output,
    notice,
  };
}

export function printInstallNextSteps(result: InstallResult): void {
  console.log(`Installed nanoclaw-webchat@${result.version} adapter into ${result.root}`);
  console.log(`Copied ${result.copied.length} files.`);
  if (result.env.created.length > 0) {
    console.log(`Added .env: ${result.env.created.join(', ')}`);
  }
  if (result.nvmrcCreated) {
    console.log('Added .nvmrc (Node 22 — matches verify/CI)');
  }
  if (result.npmrcUpdated) {
    console.log('Updated .npmrc for better-sqlite3 native rebuilds');
  }
  console.log('\nNext steps:');
  console.log('  pnpm run build');
  console.log('  pnpm exec nanoclaw-webchat verify');
  console.log('  # restart your NanoClaw host service');
  console.log('  open http://127.0.0.1:3200   # auth token is injected automatically');
  const projectMajor = readProjectNodeMajor(result.root);
  if (projectMajor !== parseInt(process.version.slice(1).split('.')[0], 10)) {
    console.log(
      `\nNote: this project targets Node ${projectMajor}. Run \`nvm use\` (or fnm/mise equivalent) if verify fails.`,
    );
  }
  const dep = readHostWebchatDependency(result.root);
  if (dep?.startsWith('file:')) {
    console.log('\nLocal file: link — after rebuilding nanoclaw-webchat, run `pnpm install` here to refresh UI assets.');
  }
}

function readHostWebchatDependency(nanoclawRoot: string): string | undefined {
  const pkgPath = path.join(nanoclawRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  return pkg.dependencies?.['nanoclaw-webchat'];
}

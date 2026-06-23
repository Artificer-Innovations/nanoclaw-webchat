import fs from 'node:fs';
import path from 'node:path';
import {
  currentNodeMajor,
  findNodeBinDirForMajor,
  projectNodeConfigLabel,
  readProjectNodeMajor,
  runUnderProjectNode,
} from './node-runner.js';

export interface EnsureBetterSqlite3Result {
  ok: boolean;
  message?: string;
  notice?: string;
  rebuilt?: boolean;
}

export function readHostBetterSqlite3Version(root: string): string | undefined {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return pkg.dependencies?.['better-sqlite3'];
  } catch {
    return undefined;
  }
}

function parseSemverTuple(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^[\^~>=<]+/, '');
  const parts = cleaned.split('.');
  return [
    parseInt(parts[0], 10) || 0,
    parseInt(parts[1], 10) || 0,
    parseInt(parts[2], 10) || 0,
  ];
}

export function parseSemverMajor(version: string): number {
  return parseSemverTuple(version)[0];
}

export function semverGte(version: string, target: string): boolean {
  const [major, minor, patch] = parseSemverTuple(version);
  const [tMajor, tMinor, tPatch] = parseSemverTuple(target);
  if (major !== tMajor) return major > tMajor;
  if (minor !== tMinor) return minor > tMinor;
  return patch >= tPatch;
}

export function isNodeSqliteCompatible(nodeMajor: number, bsqlVersion: string): boolean {
  if (nodeMajor >= 26) return semverGte(bsqlVersion, '12.10.0');
  return true;
}

function probeOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr}`.trim();
}

export function probeBetterSqlite3(root: string): { ok: boolean; output: string } {
  const result = runUnderProjectNode(root, 'node', [
    '-e',
    "require('better-sqlite3'); console.log('ok')",
  ]);
  const output = probeOutput(result);
  return { ok: result.status === 0 && output.includes('ok'), output };
}

export function rebuildBetterSqlite3(root: string): { ok: boolean; output: string; notice?: string } {
  const result = runUnderProjectNode(root, 'npm', ['rebuild', 'better-sqlite3']);
  const output = probeOutput(result);
  return {
    ok: result.status === 0,
    output,
    notice: result.notice,
  };
}

function formatFailureMessage(root: string, bsqlVersion: string, detail: string): string {
  const projectMajor = readProjectNodeMajor(root);
  const shellMajor = currentNodeMajor();
  const hasProjectNode = findNodeBinDirForMajor(projectMajor) !== null;

  const lines = [
    'nanoclaw-webchat verify could not load better-sqlite3.',
    '',
    `Project Node: ${projectMajor} (${projectNodeConfigLabel(root)}) · Shell Node: v${process.version.slice(1)} · better-sqlite3@${bsqlVersion}`,
  ];

  if (shellMajor !== projectMajor && !hasProjectNode) {
    lines.push(
      '',
      `Node ${projectMajor} is not installed. Install it, then run verify again:`,
      `  nvm install ${projectMajor}`,
    );
  }

  if (!isNodeSqliteCompatible(shellMajor, bsqlVersion)) {
    lines.push(
      '',
      `better-sqlite3@${bsqlVersion} does not support Node ${shellMajor}.`,
      'Try one of:',
      `  • Use Node ${projectMajor}: nvm install ${projectMajor}`,
      '  • Or upgrade the host driver: pnpm add better-sqlite3@^12.10.0',
    );
  }

  if (detail) {
    lines.push('', detail);
  }

  return lines.join('\n');
}

export function ensureBetterSqlite3(root: string): EnsureBetterSqlite3Result {
  const bsqlVersion = readHostBetterSqlite3Version(root);
  if (!bsqlVersion) return { ok: true };

  let notice: string | undefined;
  const first = probeBetterSqlite3(root);
  if (first.ok) return { ok: true };

  const projectMajor = readProjectNodeMajor(root);
  const shellMajor = currentNodeMajor();
  if (!isNodeSqliteCompatible(shellMajor, bsqlVersion) && shellMajor === projectMajor) {
    return {
      ok: false,
      message: formatFailureMessage(root, bsqlVersion, first.output),
    };
  }

  if (
    !isNodeSqliteCompatible(shellMajor, bsqlVersion) &&
    findNodeBinDirForMajor(projectMajor) === null &&
    process.platform === 'win32'
  ) {
    return {
      ok: false,
      message: formatFailureMessage(root, bsqlVersion, first.output),
    };
  }

  const rebuilt = rebuildBetterSqlite3(root);
  notice = rebuilt.notice;
  if (!rebuilt.ok) {
    return {
      ok: false,
      message: formatFailureMessage(root, bsqlVersion, rebuilt.output || first.output),
      notice,
    };
  }

  const second = probeBetterSqlite3(root);
  if (second.ok) {
    return { ok: true, notice, rebuilt: true };
  }

  return {
    ok: false,
    message: formatFailureMessage(root, bsqlVersion, second.output || rebuilt.output),
    notice,
  };
}

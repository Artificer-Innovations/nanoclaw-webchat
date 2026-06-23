import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const RECOMMENDED_NODE_MAJOR = 22;

export interface RunUnderProjectNodeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  usedProjectNode: boolean;
  notice?: string;
}

export function readNodeVersionFile(root: string): string | undefined {
  for (const name of ['.nvmrc', '.node-version']) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (raw) return raw.replace(/^v/, '');
  }
  return undefined;
}

export function readProjectNodeMajor(root: string): number {
  const fromFile = readNodeVersionFile(root);
  if (fromFile) {
    const major = parseInt(fromFile.split('.')[0], 10);
    if (!Number.isNaN(major)) return major;
  }
  return RECOMMENDED_NODE_MAJOR;
}

export function currentNodeMajor(): number {
  return parseInt(process.version.slice(1).split('.')[0], 10);
}

export function findNodeBinDirForMajor(major: number): string | null {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), '.nvm');
  const nvmBin = pickLatestVersionBin(path.join(nvmDir, 'versions/node'), major);
  if (nvmBin) return nvmBin;

  const fnmDir = process.env.FNM_DIR ?? path.join(os.homedir(), '.local/share/fnm');
  const fnmBin = pickLatestVersionBin(path.join(fnmDir, 'node-versions'), major);
  if (fnmBin) return fnmBin;

  const miseDir = process.env.MISE_DATA_DIR ?? path.join(os.homedir(), '.local/share/mise');
  const miseBin = pickLatestVersionBin(path.join(miseDir, 'installs/node'), major);
  if (miseBin) return miseBin;

  return null;
}

function pickLatestVersionBin(versionsDir: string, major: number): string | null {
  if (!fs.existsSync(versionsDir)) return null;
  const prefix = `v${major}.`;
  const match = fs
    .readdirSync(versionsDir)
    .filter((entry) => entry.startsWith(prefix) || entry.startsWith(`${major}.`))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!match) return null;
  const binDir = path.join(versionsDir, match, 'bin');
  return fs.existsSync(path.join(binDir, 'node')) ? binDir : null;
}

function spawnWithEnv(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32',
  });
}

function nvmExecArgs(major: number, command: string, args: string[]): string[] {
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), '.nvm');
  const nvmSh = path.join(nvmDir, 'nvm.sh');
  const quoted = [command, ...args].map(shellQuote).join(' ');
  return ['-lc', `[ -s "${nvmSh}" ] && . "${nvmSh}"; nvm exec ${major} ${quoted}`];
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function runUnderProjectNode(
  root: string,
  command: string,
  args: string[],
): RunUnderProjectNodeResult {
  const projectMajor = readProjectNodeMajor(root);
  const shellMajor = currentNodeMajor();

  if (shellMajor === projectMajor) {
    const result = spawnWithEnv(command, args, root, process.env);
    return wrapSpawnResult(result, false);
  }

  const binDir = findNodeBinDirForMajor(projectMajor);
  if (binDir) {
    const env = {
      ...process.env,
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      npm_node_execpath: path.join(binDir, 'node'),
    };
    const result = spawnWithEnv(command, args, root, env);
    const notice = `Using Node v${projectMajor} from project config (.nvmrc); your shell is on v${shellMajor}.`;
    return wrapSpawnResult(result, true, notice);
  }

  if (process.platform !== 'win32') {
    const result = spawnWithEnv('bash', nvmExecArgs(projectMajor, command, args), root, process.env);
    const stdoutLen = (result.stdout ?? '').length;
    const stderrLen = (result.stderr ?? '').length;
    const accepted = result.status === 0 || stdoutLen > 0 || stderrLen > 0;
    if (accepted) {
      const notice = `Using Node v${projectMajor} via nvm exec; your shell is on v${shellMajor}.`;
      return wrapSpawnResult(result, true, notice);
    }
  }

  const result = spawnWithEnv(command, args, root, process.env);
  return wrapSpawnResult(result, false);
}

function wrapSpawnResult(
  result: SpawnSyncReturns<string>,
  usedProjectNode: boolean,
  notice?: string,
): RunUnderProjectNodeResult {
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    usedProjectNode,
    notice,
  };
}

export function scaffoldProjectNodeFiles(root: string): { nvmrcCreated: boolean; npmrcUpdated: boolean } {
  let nvmrcCreated = false;
  let npmrcUpdated = false;

  const nvmrcPath = path.join(root, '.nvmrc');
  if (!fs.existsSync(nvmrcPath) && !fs.existsSync(path.join(root, '.node-version'))) {
    fs.writeFileSync(nvmrcPath, `${RECOMMENDED_NODE_MAJOR}\n`);
    nvmrcCreated = true;
  }

  const npmrcPath = path.join(root, '.npmrc');
  const marker = 'onlyBuiltDependencies[]=better-sqlite3';
  const comment = '# nanoclaw-webchat: rebuild better-sqlite3 native bindings on install (see QUICKSTART.md)';
  if (fs.existsSync(npmrcPath)) {
    const existing = fs.readFileSync(npmrcPath, 'utf8');
    if (!existing.includes(marker)) {
      const prefix = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
      fs.writeFileSync(npmrcPath, `${existing}${prefix}${comment}\n${marker}\n`);
      npmrcUpdated = true;
    }
  } else {
    fs.writeFileSync(npmrcPath, `${comment}\n${marker}\n`);
    npmrcUpdated = true;
  }

  return { nvmrcCreated, npmrcUpdated };
}

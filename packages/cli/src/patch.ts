import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADAPTER_COPY_RULES,
  resourcesDir,
  skillDir,
  WEBCHAT_BARREL_IMPORT,
  WEBCHAT_BOOT_BLOCK,
} from './paths.js';

const HOST_ADAPTER_DEPENDENCIES: Record<string, string> = {
  busboy: '^1.6.0',
};

const HOST_ADAPTER_DEV_DEPENDENCIES: Record<string, string> = {
  '@types/busboy': '^1.5.4',
};

/** Ensure runtime/type deps required by copied adapter sources exist on the host. */
export function ensureHostAdapterDependencies(nanoclawRoot: string): string[] {
  const pkgPath = path.join(nanoclawRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const added: string[] = [];
  pkg.dependencies ??= {};
  pkg.devDependencies ??= {};

  for (const [name, version] of Object.entries(HOST_ADAPTER_DEPENDENCIES)) {
    if (!pkg.dependencies[name]) {
      pkg.dependencies[name] = version;
      added.push(name);
    }
  }
  for (const [name, version] of Object.entries(HOST_ADAPTER_DEV_DEPENDENCIES)) {
    if (!pkg.devDependencies[name]) {
      pkg.devDependencies[name] = version;
      added.push(name);
    }
  }

  if (added.length > 0) {
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  return added;
}

export function copyAdapterFiles(nanoclawRoot: string, resources = resourcesDir()): string[] {
  const copied: string[] = [];
  for (const rule of ADAPTER_COPY_RULES) {
    const from = path.join(resources, rule.source);
    const to = path.join(nanoclawRoot, rule.dest);
    if (!fs.existsSync(from)) {
      throw new Error(`Missing adapter resource: ${rule.source}`);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    copied.push(rule.dest);
  }
  return copied;
}

export function appendBarrelImport(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/channels/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(WEBCHAT_BARREL_IMPORT)) return false;
  const next = content.endsWith('\n')
    ? `${content}${WEBCHAT_BARREL_IMPORT}\n`
    : `${content}\n${WEBCHAT_BARREL_IMPORT}\n`;
  fs.writeFileSync(filePath, next);
  return true;
}

export function removeBarrelImport(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/channels/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const filtered = lines.filter((line) => line.trim() !== WEBCHAT_BARREL_IMPORT);
  if (filtered.length === lines.length) return false;
  const body = filtered.join('\n');
  fs.writeFileSync(filePath, `${body.replace(/\n?$/, '')}\n`);
  return true;
}

/** Keys written by scaffoldEnv — uninstall removes only these, not other WEBCHAT_* vars. */
export const SCAFFOLDED_ENV_KEYS = ['WEBCHAT_ENABLED', 'WEBCHAT_PORT', 'WEBCHAT_SECRET'] as const;

const WEBCHAT_BOOT_BLOCK_PATTERN =
  /^[ \t]*const \{ startWebChat \} = await import\('\.\/webchat-boot\.js'\);\r?\n^[ \t]*await startWebChat\(\);\r?\n(?:\r?\n)?/m;

/** Index in src/index.ts where the webchat boot block should be inserted (start of line). */
export function findWebchatBootInsertIndex(content: string): number {
  const awaited = content.match(/^\s+await initChannelAdapters\(/m);
  if (awaited?.index != null) return awaited.index;

  const plain = content.match(/^\s+initChannelAdapters\(/m);
  if (plain?.index != null) return plain.index;

  return -1;
}

export function hasWebchatBootBlock(content: string): boolean {
  return WEBCHAT_BOOT_BLOCK_PATTERN.test(content);
}

export function insertWebchatBootBlock(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  if (hasWebchatBootBlock(content)) return false;
  const idx = findWebchatBootInsertIndex(content);
  if (idx < 0) {
    throw new Error('Could not find initChannelAdapters( in src/index.ts');
  }
  const updated = `${content.slice(0, idx)}${WEBCHAT_BOOT_BLOCK}\n\n${content.slice(idx)}`;
  fs.writeFileSync(filePath, updated);
  return true;
}

export function removeWebchatBootBlock(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  if (!hasWebchatBootBlock(content)) return false;
  fs.writeFileSync(filePath, content.replace(WEBCHAT_BOOT_BLOCK_PATTERN, ''));
  return true;
}

export function scaffoldEnv(nanoclawRoot: string): { created: string[]; skipped: string[] } {
  const envPath = path.join(nanoclawRoot, '.env');
  const created: string[] = [];
  const skipped: string[] = [];
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').split('\n') : [];
  const existing = new Set(lines.map((l) => l.split('=')[0]?.trim()).filter(Boolean));

  const additions: Record<string, string> = {
    WEBCHAT_ENABLED: 'true',
    WEBCHAT_PORT: '3200',
    WEBCHAT_SECRET: randomBytes(16).toString('hex'),
  };

  for (const [key, value] of Object.entries(additions)) {
    if (existing.has(key)) {
      skipped.push(key);
      continue;
    }
    lines.push(`${key}=${value}`);
    created.push(key);
  }

  if (created.length > 0) {
    fs.writeFileSync(envPath, `${lines.join('\n').replace(/\n?$/, '')}\n`);
  }

  return { created, skipped };
}

export function removeEnvVars(nanoclawRoot: string): string[] {
  const envPath = path.join(nanoclawRoot, '.env');
  if (!fs.existsSync(envPath)) return [];
  const removed: string[] = [];
  const allowlist = new Set<string>(SCAFFOLDED_ENV_KEYS);
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  const kept = lines.filter((line) => {
    const key = line.split('=')[0]?.trim();
    if (key && allowlist.has(key)) {
      removed.push(key);
      return false;
    }
    return true;
  });
  const body = kept.join('\n');
  fs.writeFileSync(envPath, `${body.replace(/\n?$/, '')}\n`);
  return removed;
}

export function syncSkillToFork(nanoclawRoot: string, skillSource = skillDir()): string {
  const dest = path.join(nanoclawRoot, '.claude/skills/add-webchat');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyDir(skillSource, dest);
  return dest;
}

export function removeAdapterFiles(nanoclawRoot: string): string[] {
  const removed: string[] = [];
  for (const rule of ADAPTER_COPY_RULES) {
    const target = path.join(nanoclawRoot, rule.dest);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
      removed.push(rule.dest);
    }
  }
  return removed;
}

function copyDir(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

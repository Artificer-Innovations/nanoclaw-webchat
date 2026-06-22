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
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const filtered = lines.filter((line) => line.trim() !== WEBCHAT_BARREL_IMPORT);
  if (filtered.length === lines.length) return false;
  fs.writeFileSync(filePath, filtered.join('\n'));
  return true;
}

/** Index in src/index.ts where the webchat boot block should be inserted (start of line). */
export function findWebchatBootInsertIndex(content: string): number {
  const awaited = content.match(/^  await initChannelAdapters\(/m);
  if (awaited?.index != null) return awaited.index;

  const plain = content.match(/^  initChannelAdapters\(/m);
  if (plain?.index != null) return plain.index;

  return -1;
}

export function insertWebchatBootBlock(nanoclawRoot: string): boolean {
  const filePath = path.join(nanoclawRoot, 'src/index.ts');
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('startWebChat()')) return false;
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
  const replacements: Array<[string, string]> = [
    [`${WEBCHAT_BOOT_BLOCK}\n\n  await initChannelAdapters(`, 'await initChannelAdapters('],
    [`${WEBCHAT_BOOT_BLOCK}\n\n  initChannelAdapters(`, 'initChannelAdapters('],
    [`await ${WEBCHAT_BOOT_BLOCK}\n\n  initChannelAdapters(`, 'await initChannelAdapters('],
    [`${WEBCHAT_BOOT_BLOCK}\n\n`, ''],
    [`${WEBCHAT_BOOT_BLOCK}\n`, ''],
  ];
  for (const [pattern, replacement] of replacements) {
    if (content.includes(pattern)) {
      fs.writeFileSync(filePath, content.replace(pattern, replacement));
      return true;
    }
  }
  return false;
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
    const body = lines.join('\n');
    fs.writeFileSync(envPath, body.endsWith('\n') ? body : `${body}\n`);
  }

  return { created, skipped };
}

export function removeEnvVars(nanoclawRoot: string): string[] {
  const envPath = path.join(nanoclawRoot, '.env');
  if (!fs.existsSync(envPath)) return [];
  const removed: string[] = [];
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const kept = lines.filter((line) => {
    const key = line.split('=')[0]?.trim();
    if (key?.startsWith('WEBCHAT_')) {
      removed.push(key);
      return false;
    }
    return true;
  });
  fs.writeFileSync(envPath, kept.join('\n'));
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

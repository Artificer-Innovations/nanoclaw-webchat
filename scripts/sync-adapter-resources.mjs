#!/usr/bin/env node
/**
 * Sync packages/adapter/src → skills/add-webchat/resources before publish.
 *
 * Intentionally copies every *.ts file in packages/adapter/src — the skill bundle
 * should mirror the full adapter source set (see ADAPTER_COPY_RULES in paths.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'packages/adapter/src');
const destDir = path.join(root, 'skills/add-webchat/resources');

fs.mkdirSync(destDir, { recursive: true });

for (const name of fs.readdirSync(srcDir)) {
  if (!name.endsWith('.ts')) continue;
  fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
}

console.log(`Synced adapter resources → ${path.relative(root, destDir)}`);

#!/usr/bin/env node
/**
 * Sync packages/adapter/src → skills/add-webchat/resources before publish.
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

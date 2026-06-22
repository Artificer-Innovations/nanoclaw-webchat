#!/usr/bin/env node
/**
 * Regression guard: root dist/index.js must export getAssetDir() and point at
 * the Vite-built SPA (dist/client/index.html). Catches copy-shared-types or
 * build-order regressions before publish.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPath = path.join(root, 'dist/index.js');

if (!fs.existsSync(entryPath)) {
  console.error('verify-publish-entry: missing dist/index.js — run pnpm run build first');
  process.exit(1);
}

const mod = await import(pathToFileURL(entryPath).href);
if (typeof mod.getAssetDir !== 'function') {
  console.error(
    'verify-publish-entry: dist/index.js does not export getAssetDir() — root entry was overwritten',
  );
  process.exit(1);
}

const assetDir = mod.getAssetDir();
const indexHtml = path.join(assetDir, 'index.html');
if (!fs.existsSync(indexHtml)) {
  console.error(
    `verify-publish-entry: getAssetDir() returned ${assetDir} but index.html is missing`,
  );
  process.exit(1);
}

console.log('verify-publish-entry: ok', assetDir);

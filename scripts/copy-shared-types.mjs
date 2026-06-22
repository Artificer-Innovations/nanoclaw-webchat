#!/usr/bin/env node
/**
 * Copy shared type artifacts into root dist/ for npm consumers.
 * Private workspace @nanoclaw-webchat/shared is not published.
 *
 * Runs twice in `pnpm run build`: once before the client tsc emit (so
 * dist/types.* exists for index.d.ts re-exports) and again after the MCP
 * build rewrites all dist .d.ts files that reference the workspace package.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedDist = path.join(root, 'packages/shared/dist');
const outDir = path.join(root, 'dist');

for (const file of ['types.js', 'types.d.ts', 'index.js', 'index.d.ts']) {
  const src = path.join(sharedDist, file);
  if (!fs.existsSync(src)) {
    throw new Error(`Expected ${src} — run shared build first`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.copyFileSync(src, path.join(outDir, file));
}

function fixDeclarationFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      fixDeclarationFiles(fullPath);
      continue;
    }
    if (!entry.name.endsWith('.d.ts')) continue;
    const content = fs.readFileSync(fullPath, 'utf8');
    if (!content.includes('@nanoclaw-webchat/shared')) continue;
    const relTypes = path
      .relative(path.dirname(fullPath), path.join(outDir, 'types'))
      .replace(/\\/g, '/');
    const importPath = relTypes.startsWith('.') ? relTypes : `./${relTypes}`;
    fs.writeFileSync(
      fullPath,
      content.replaceAll('@nanoclaw-webchat/shared', importPath),
    );
  }
}

fixDeclarationFiles(outDir);

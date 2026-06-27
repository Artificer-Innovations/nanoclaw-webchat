import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the published nanoclaw-webchat package. */
export function packageRoot(startDir: string = __dirname): string {
  let dir = startDir;
  for (;;) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name === 'nanoclaw-webchat') {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate nanoclaw-webchat package root');
}

export function skillDir(startDir: string = __dirname): string {
  return path.join(packageRoot(startDir), 'skills/add-webchat');
}

/** Canonical adapter source in the monorepo. */
export function adapterSrcDir(startDir: string = __dirname): string {
  return path.join(packageRoot(startDir), 'packages/adapter/src');
}

/**
 * Directory to copy adapter files from.
 * Monorepo: packages/adapter/src (source of truth).
 * Published npm package: skills/add-webchat/resources (synced at build time).
 *
 * Detection is implicit: the published tarball excludes `packages/` (see root
 * package.json `files`), so `packages/adapter/src` is absent there and we fall
 * back to build-synced skill resources. No separate isMonorepo flag needed.
 */
export function resourcesDir(startDir: string = __dirname, nanoclawRoot?: string): string {
  const adapterSrc = adapterSrcDir(startDir);
  if (fs.existsSync(path.join(adapterSrc, 'web.ts'))) {
    return adapterSrc;
  }
  if (nanoclawRoot) {
    const linked = resolveLinkedAdapterSrc(nanoclawRoot);
    if (linked) return linked;
  }
  return path.join(skillDir(startDir), 'resources');
}

/** When the host uses `file:` to link the monorepo, pnpm may omit `packages/` from node_modules. */
export function resolveLinkedAdapterSrc(nanoclawRoot: string): string | null {
  const pkgPath = path.join(nanoclawRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const dep = pkg.dependencies?.['nanoclaw-webchat'];
  if (!dep?.startsWith('file:')) return null;
  const linkedRoot = path.resolve(nanoclawRoot, dep.slice('file:'.length));
  const adapterSrc = path.join(linkedRoot, 'packages/adapter/src');
  if (fs.existsSync(path.join(adapterSrc, 'web.ts'))) return adapterSrc;
  return null;
}

export interface AdapterCopyRule {
  source: string;
  dest: string;
}

export const ADAPTER_COPY_RULES: AdapterCopyRule[] = [
  { source: 'web.ts', dest: 'src/channels/web.ts' },
  { source: 'web.test.ts', dest: 'src/channels/web.test.ts' },
  { source: 'web-registration.test.ts', dest: 'src/channels/web-registration.test.ts' },
  { source: 'webchat-sync.ts', dest: 'src/webchat-sync.ts' },
  { source: 'webchat-sync.test.ts', dest: 'src/webchat-sync.test.ts' },
  { source: 'webchat-boot.ts', dest: 'src/webchat-boot.ts' },
  { source: 'webchat-wiring.test.ts', dest: 'src/webchat-wiring.test.ts' },
  { source: 'webchat-store.ts', dest: 'src/webchat-store.ts' },
  { source: 'webchat-store.test.ts', dest: 'src/webchat-store.test.ts' },
  { source: 'webchat-uploads.ts', dest: 'src/webchat-uploads.ts' },
  { source: 'webchat-uploads.test.ts', dest: 'src/webchat-uploads.test.ts' },
  { source: 'webchat-serve-attachment.ts', dest: 'src/webchat-serve-attachment.ts' },
  { source: 'webchat-serve-attachment.test.ts', dest: 'src/webchat-serve-attachment.test.ts' },
  { source: 'webchat-thread-cleanup.ts', dest: 'src/webchat-thread-cleanup.ts' },
  { source: 'webchat-routing.ts', dest: 'src/webchat-routing.ts' },
  { source: 'webchat-routing.test.ts', dest: 'src/webchat-routing.test.ts' },
  { source: 'webchat-mentions.ts', dest: 'src/webchat-mentions.ts' },
  { source: 'webchat-mentions.test.ts', dest: 'src/webchat-mentions.test.ts' },
];

export const WEBCHAT_BARREL_IMPORT = "import './web.js';";

export const WEBCHAT_BOOT_BLOCK = `  const { startWebChat } = await import('./webchat-boot.js');
  await startWebChat();`;

export const VERIFY_TESTS = [
  'src/channels/web-registration.test.ts',
  'src/channels/web.test.ts',
  'src/webchat-sync.test.ts',
  'src/webchat-wiring.test.ts',
];

export function findNanoclawRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    const channelsIndex = path.join(dir, 'src/channels/index.ts');
    const hostIndex = path.join(dir, 'src/index.ts');
    if (fs.existsSync(channelsIndex) && fs.existsSync(hostIndex)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    'NanoClaw root not found (expected src/channels/index.ts and src/index.ts). Use --path.',
  );
}

export function readPackageVersion(): string {
  const pkgPath = path.join(packageRoot(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  return pkg.version ?? '0.0.0';
}

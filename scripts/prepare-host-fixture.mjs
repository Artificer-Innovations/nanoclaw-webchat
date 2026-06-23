#!/usr/bin/env node
/**
 * Build test/fixtures/nanoclaw-host — a minimal NanoClaw host skeleton used by
 * CI integration tests. No external nanoclaw-v2 checkout required.
 *
 * Maintainers: when host DB / channel APIs change, re-run against a local
 * nanoclaw fork and commit the updated fixture:
 *   NANOCLAW_SRC=../nanoclaw-v2 node scripts/prepare-host-fixture.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webchatRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(webchatRoot, 'test/fixtures/nanoclaw-host');
const nanoclawSrc =
  process.env.NANOCLAW_SRC ??
  (fs.existsSync(path.join(webchatRoot, '../nanoclaw-v2'))
    ? path.join(webchatRoot, '../nanoclaw-v2')
    : null);

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyTree(fromDir, toDir, { excludeTest = true } = {}) {
  for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
    if (excludeTest && entry.name.endsWith('.test.ts')) continue;
    const src = path.join(fromDir, entry.name);
    const dest = path.join(toDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(src, dest, { excludeTest });
    } else {
      copyFile(src, dest);
    }
  }
}

function write(relativePath, content) {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

if (!nanoclawSrc || !fs.existsSync(path.join(nanoclawSrc, 'src/db/connection.ts'))) {
  console.error(
    'NANOCLAW_SRC must point at a NanoClaw fork with src/db/connection.ts (e.g. ../nanoclaw-v2).',
  );
  process.exit(1);
}

fs.rmSync(fixtureRoot, { recursive: true, force: true });
fs.mkdirSync(fixtureRoot, { recursive: true });

copyFile(path.join(nanoclawSrc, 'tsconfig.json'), path.join(fixtureRoot, 'tsconfig.json'));

write(
  'vitest.config.ts',
  `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
`,
);

write(
  'package.json',
  JSON.stringify(
    {
      name: 'nanoclaw-host-fixture',
      private: true,
      type: 'module',
      scripts: {
        test: 'vitest run',
      },
      dependencies: {
        'better-sqlite3': '11.10.0',
        ws: '8.18.3',
      },
      devDependencies: {
        '@types/better-sqlite3': '^7.6.12',
        '@types/node': '^22.10.0',
        '@types/ws': '8.18.1',
        typescript: '^5.7.0',
        vitest: '^4.0.18',
      },
      pnpm: {
        allowBuilds: {
          'better-sqlite3': true,
        },
      },
    },
    null,
    2,
  ) + '\n',
);

write(
  '.gitignore',
  `node_modules/
data/
dist/
.env
pnpm-lock.yaml
`,
);

write(
  'pnpm-workspace.yaml',
  `allowBuilds:
  better-sqlite3: true
`,
);

write(
  '.npmrc',
  `# Fixture installs outside the nanoclaw-webchat pnpm workspace.
ignore-workspace-root-check=true
`,
);

write(
  'README.md',
  `# NanoClaw host fixture

Minimal in-repo NanoClaw host skeleton for \`scripts/run-integration.mjs\`.
CI runs entirely within nanoclaw-webchat — no external host repo checkout.

Regenerate from a local NanoClaw fork when host DB/channel APIs change:

\`\`\`bash
NANOCLAW_SRC=../nanoclaw-v2 node scripts/prepare-host-fixture.mjs
\`\`\`
`,
);

copyTree(path.join(nanoclawSrc, 'src/db'), path.join(fixtureRoot, 'src/db'));
copyFile(path.join(nanoclawSrc, 'src/types.ts'), path.join(fixtureRoot, 'src/types.ts'));
copyFile(path.join(nanoclawSrc, 'src/env.ts'), path.join(fixtureRoot, 'src/env.ts'));
copyFile(path.join(nanoclawSrc, 'src/log.ts'), path.join(fixtureRoot, 'src/log.ts'));
copyFile(path.join(nanoclawSrc, 'src/channels/adapter.ts'), path.join(fixtureRoot, 'src/channels/adapter.ts'));
copyFile(
  path.join(nanoclawSrc, 'src/channels/channel-registry.ts'),
  path.join(fixtureRoot, 'src/channels/channel-registry.ts'),
);

copyTree(
  path.join(nanoclawSrc, 'src/modules/permissions/db'),
  path.join(fixtureRoot, 'src/modules/permissions/db'),
);
copyTree(
  path.join(nanoclawSrc, 'src/modules/agent-to-agent/db'),
  path.join(fixtureRoot, 'src/modules/agent-to-agent/db'),
);

write(
  'src/config.ts',
  `import path from 'path';

/** Minimal config for integration fixture — only DATA_DIR is required by webchat-store. */
export const DATA_DIR = path.resolve(process.cwd(), 'data');
`,
);

write(
  'src/router.ts',
  `import type { InboundEvent } from './channels/adapter.js';

export async function routeInbound(_event: InboundEvent): Promise<void> {}
`,
);

write(
  'src/container-runner.ts',
  `export function isContainerRunning(_sessionId: string): boolean {
  return false;
}

export async function wakeContainer(): Promise<void> {}
`,
);

write(
  'src/session-manager.ts',
  `export function sessionDir(_agentFolder: string, _sessionId: string): string {
  return '/tmp/nanoclaw-fixture-session';
}
`,
);

copyFile(path.join(nanoclawSrc, 'src/db/sessions.ts'), path.join(fixtureRoot, 'src/db/sessions.ts'));

write(
  'src/channels/cli.ts',
  `import { registerChannelAdapter } from './channel-registry.js';
import type { ChannelAdapter, ChannelSetup } from './adapter.js';

function createAdapter(): ChannelAdapter {
  return {
    name: 'cli',
    channelType: 'cli',
    async setup(_setup: ChannelSetup) {},
    async teardown() {},
    async deliver() {
      return false;
    },
  };
}

registerChannelAdapter('cli', { factory: createAdapter });
`,
);

write(
  'src/channels/index.ts',
  `// Channel self-registration barrel (fixture — cli only; web added by install).
import './cli.js';
`,
);

write(
  'src/index.ts',
  `/**
 * Minimal NanoClaw host entry for integration tests.
 */
import { initDb } from './db/connection.js';
import { runMigrations } from './db/migrations/index.js';
import {
  initChannelAdapters,
  type ChannelAdapter,
} from './channels/channel-registry.js';
import type { ChannelSetup } from './channels/adapter.js';
import { routeInbound } from './router.js';
import { DATA_DIR } from './config.js';
import path from 'path';

async function main(): Promise<void> {
  const dbPath = path.join(DATA_DIR, 'v2.db');
  const db = initDb(dbPath);
  runMigrations(db);

  await initChannelAdapters((adapter: ChannelAdapter): ChannelSetup => {
    return {
      onInbound(platformId, threadId, message) {
        routeInbound({
          channelType: adapter.channelType,
          instance: adapter.instance ?? adapter.channelType,
          platformId,
          threadId,
          message: {
            id: message.id,
            kind: message.kind,
            content: JSON.stringify(message.content),
            timestamp: message.timestamp,
            isMention: message.isMention,
            isGroup: message.isGroup,
          },
        });
      },
      onInboundEvent(event) {
        routeInbound(event);
      },
      onMetadata() {},
      onAction() {},
    };
  });
}

void main();
`,
);

console.log(`Prepared host fixture at ${fixtureRoot}`);

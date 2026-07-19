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
        onlyBuiltDependencies: ['better-sqlite3'],
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
import type { AgentGroup, MessagingGroup, MessagingGroupAgent } from './types.js';

function safeParseContent(raw: string): { text?: string; sender?: string; senderId?: string } {
  try {
    return JSON.parse(raw);
  } catch {
    return { text: raw };
  }
}

export async function routeInbound(event: InboundEvent): Promise<void> {
  const isMention = event.message.isMention === true;
  const agents: MessagingGroupAgent[] = [];
  const mg = { id: 'mg', is_group: 1 } as MessagingGroup;
  const userId: string | null = null;
  const accessGate = null;
  const senderScopeGate = null;

  const parsed = safeParseContent(event.message.content);
  const messageText = parsed.text ?? '';

  // Per-wiring thread policy inputs, resolved once per event.
  for (const agent of agents) {
    const agentGroup = { folder: 'agent' } as AgentGroup;
    const threadsEnabled = true;
    const effectiveThreadId = threadsEnabled ? event.threadId : null;

    const engages = evaluateEngage(agent, messageText, isMention, mg, effectiveThreadId);
    const accessOk = engages && (!accessGate || true);
    const scopeOk = engages && (!senderScopeGate || true);

    if (engages && accessOk && scopeOk) {
      await deliverToAgent(agent, agentGroup, mg, event, userId, threadsEnabled, effectiveThreadId, true);
    } else if (agent.ignored_message_policy === 'accumulate') {
      await deliverToAgent(agent, agentGroup, mg, event, userId, threadsEnabled, effectiveThreadId, false);
    }
  }
}

function evaluateEngage(
  _agent: MessagingGroupAgent,
  _text: string,
  _isMention: boolean,
  _mg: MessagingGroup,
  _threadId: string | null,
): boolean {
  return false;
}

async function deliverToAgent(
  agent: MessagingGroupAgent,
  agentGroup: AgentGroup,
  mg: MessagingGroup,
  event: InboundEvent,
  userId: string | null,
  threadsEnabled: boolean,
  effectiveThreadId: string | null,
  wake: boolean,
): Promise<void> {
  void agent;
  void agentGroup;
  void mg;
  void userId;
  void threadsEnabled;
  void effectiveThreadId;
  void wake;
  if (event.message.kind === 'chat' || event.message.kind === 'chat-sdk') {
    return;
  }
}
`,
);

write(
  'src/delivery.ts',
  `import { getAgentGroup } from './db/agent-groups.js';
import { readOutboxFiles } from './session-manager.js';
import type { Session } from './types.js';

const deliveryAdapter = {
  async deliver(
    _channelType: string,
    _platformId: string,
    _threadId: string | null,
    _kind: string,
    _content: string,
    _files?: unknown[],
    _instance?: string,
  ): Promise<string | undefined> {
    return undefined;
  },
};

export async function deliverMessage(
  msg: {
    id: string;
    kind: string;
    platform_id: string | null;
    channel_type: string | null;
    thread_id: string | null;
    content: string;
  },
  session: Session,
): Promise<string | undefined> {
  const content = JSON.parse(msg.content) as Record<string, unknown>;
  const deliverInstance = msg.channel_type ?? undefined;
  if (!msg.channel_type || !msg.platform_id) return;

  // Read file attachments from outbox if the content declares files.
  // File I/O lives in session-manager.ts (symmetric with inbound
  // extractAttachmentFiles) — delivery just hands buffers to the adapter.
  const files =
    Array.isArray(content.files) && content.files.length > 0
      ? readOutboxFiles(session.agent_group_id, session.id, msg.id, content.files as string[])
      : undefined;

  const platformMsgId = await deliveryAdapter.deliver(
    msg.channel_type,
    msg.platform_id,
    msg.thread_id,
    msg.kind,
    msg.content,
    files,
    deliverInstance,
  );
  return platformMsgId;
}

export function registerDeliveryAction(
  _action: string,
  _handler: (...args: unknown[]) => Promise<void>,
  _spec?: unknown,
): void {}

export function reenterGuardedDeliveryAction(_action: string): (ctx: unknown) => Promise<void> {
  return async () => undefined;
}

void getAgentGroup;
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

export function readOutboxFiles(
  _agentGroupId: string,
  _sessionId: string,
  _messageId: string,
  _files: string[],
): unknown[] {
  return [];
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

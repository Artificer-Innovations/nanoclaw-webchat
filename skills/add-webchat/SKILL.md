---
name: add-webchat
description: Add a local browser web chat channel to NanoClaw. Lobby with @agent patterns, per-agent DMs, and threading. Installs @artificer-innovations/nanoclaw-webchat and a native web channel adapter.
---

# /add-webchat — Web Chat Channel

Adds a localhost browser chat desk wired through NanoClaw's normal router/delivery path.

See also: [QUICKSTART.md](../../QUICKSTART.md) in the npm package for a human-readable install guide.

## Architecture

```
Browser (@artificer-innovations/nanoclaw-webchat)  ←HTTP/WS→  web.ts adapter  →  router  →  agents
                                              webchat-sync.ts  →  DB wirings
```

## Install

NanoClaw does not ship webchat in trunk. This skill copies the adapter from the installed `@artificer-innovations/nanoclaw-webchat` npm package.

### Pre-flight (idempotent)

Skip to **Credentials** if all of these are already in place:

- `src/channels/web.ts` and `src/webchat-store.ts` exist
- `src/channels/index.ts` contains `import './web.js';`
- `src/index.ts` contains `await startWebChat()` before `initChannelAdapters(`
- `@artificer-innovations/nanoclaw-webchat` and `ws` are listed in `package.json`

Otherwise continue. Every step below is safe to re-run.

### 0. Copy this skill (first time only)

If `/add-webchat` is not already in your fork:

```bash
pnpm exec nanoclaw-webchat sync-skill
```

### 1. Install npm packages

```bash
pnpm add @artificer-innovations/nanoclaw-webchat@0.2.0 ws@8.18.3
pnpm add -D @types/ws@8.18.1
```

If the package is not yet on npm, install from a local build:

```bash
pnpm add file:../nanoclaw-webchat
```

### 2. Copy adapter resources into `src/`

Copy from `node_modules/@artificer-innovations/nanoclaw-webchat/skills/add-webchat/resources/`:

```bash
PKG=node_modules/@artificer-innovations/nanoclaw-webchat/skills/add-webchat/resources
cp "$PKG/web.ts" src/channels/web.ts
cp "$PKG/web.test.ts" src/channels/web.test.ts
cp "$PKG/web-registration.test.ts" src/channels/web-registration.test.ts
cp "$PKG/webchat-sync.ts" src/webchat-sync.ts
cp "$PKG/webchat-sync.test.ts" src/webchat-sync.test.ts
cp "$PKG/webchat-boot.ts" src/webchat-boot.ts
cp "$PKG/webchat-wiring.test.ts" src/webchat-wiring.test.ts
cp "$PKG/webchat-store.ts" src/webchat-store.ts
cp "$PKG/webchat-store.test.ts" src/webchat-store.test.ts
cp "$PKG/webchat-thread-cleanup.ts" src/webchat-thread-cleanup.ts
cp "$PKG/webchat-routing.ts" src/webchat-routing.ts
cp "$PKG/webchat-routing.test.ts" src/webchat-routing.test.ts
cp "$PKG/webchat-mentions.ts" src/webchat-mentions.ts
cp "$PKG/webchat-mentions.test.ts" src/webchat-mentions.test.ts
```

Or run the CLI (same result):

```bash
pnpm exec nanoclaw-webchat install
```

### 3. Append the self-registration import

Append to `src/channels/index.ts` (skip if present):

```typescript
import './web.js';
```

### 4. Wire into `src/index.ts`

Add this block inside `main()`, after DB migrations/backfill and **before** `initChannelAdapters(...)`:

```typescript
  const { startWebChat } = await import('./webchat-boot.js');
  await startWebChat();
```

### 5. Build and validate

```bash
pnpm run build
pnpm exec vitest run src/channels/web-registration.test.ts src/channels/web.test.ts src/webchat-sync.test.ts src/webchat-wiring.test.ts
```

Or:

```bash
pnpm exec nanoclaw-webchat verify
```

Restart your NanoClaw host service after a clean build.

## Credentials

Add to `.env` (or let `nanoclaw-webchat install` scaffold these):

```bash
WEBCHAT_ENABLED=true
WEBCHAT_PORT=3200
WEBCHAT_SECRET=<random>
WEBCHAT_TEAM_FOLDER=dm-with-brad   # optional — enables @team on this agent
WEBCHAT_USER_ID=web:local          # optional
WEBCHAT_DISPLAY_NAME=Local         # optional
```

Generate secret: `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`

## Verify

Open `http://127.0.0.1:3200` and paste `WEBCHAT_SECRET`.

- **Lobby:** `@sarah hello` routes to the sarah agent
- **DM:** pick an agent in the sidebar — all messages go to that agent
- **Threads:** use **New thread** in the lobby header

## Channel Info

| Field | Value |
|-------|-------|
| channel type | `web` |
| platform ids | `lobby`, `dm:<folder>` |
| terminology | room / thread |
| typical use | local browser desk for multi-agent @ routing |
| default isolation | separate sessions per thread; shared agent workspace per agent group |

## Upgrading

```bash
pnpm update @artificer-innovations/nanoclaw-webchat
pnpm exec nanoclaw-webchat upgrade
pnpm run build
# restart host
```

UI-only updates may only require a host restart. Adapter changes require re-running install/upgrade.

## Troubleshooting

- **401 in browser:** wrong `WEBCHAT_SECRET`
- **Messages dropped:** ensure `web:local` user has member access (sync adds this automatically)
- **Agent not engaging in lobby:** message must match `@<folder>` pattern (e.g. `@sarah`)
- **Package missing:** run step 1; build must pass before tests

See [REMOVE.md](REMOVE.md) to uninstall.

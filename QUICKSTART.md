# NanoClaw Webchat — Quickstart

Install the browser web chat channel into an **existing, working NanoClaw fork**.

## Prerequisites

- A NanoClaw fork already running (agents, `.env`, host service)
- Node.js ≥ 20 and pnpm
- Claude Code (optional — for `/add-webchat`)

## What gets installed where

| Piece | Location after install | Updates when you… |
|-------|------------------------|-------------------|
| npm package (UI + skill + adapter templates) | `node_modules/@artificer-innovations/nanoclaw-webchat/` | `pnpm update @artificer-innovations/nanoclaw-webchat` |
| Browser UI assets | served from `node_modules/.../dist/client/` at runtime | update package + restart host |
| Adapter code | copied into **your fork** `src/channels/web.ts`, `src/webchat-*.ts` | re-run `install` or `upgrade` |
| `/add-webchat` skill | `.claude/skills/add-webchat/` in your fork | `nanoclaw-webchat sync-skill` or `upgrade` |
| Message history | `data/webchat.db` in your fork | persists across upgrades |

You do **not** need to clone this repository beside your NanoClaw fork.

## First-time install

### 1. Add the npm package

```bash
cd ~/Dev/my-nanoclaw          # your NanoClaw fork
pnpm add @artificer-innovations/nanoclaw-webchat@0.2.0 ws@8.18.3
pnpm add -D @types/ws@8.18.1
```

### 2. Install the channel adapter

**Option A — Claude Code (recommended):**

```bash
pnpm exec nanoclaw-webchat sync-skill
# In Claude Code:
/add-webchat
```

**Option B — CLI:**

```bash
pnpm exec nanoclaw-webchat install
```

Both copy adapter files into `src/`, wire `src/channels/index.ts` and `src/index.ts`, and scaffold `.env` variables if missing.

### 3. Configure environment

If install did not create them, add to `.env`:

```bash
WEBCHAT_ENABLED=true
WEBCHAT_PORT=3200
WEBCHAT_SECRET=<random hex>
```

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Optional:

```bash
WEBCHAT_TEAM_FOLDER=your-team-folder
WEBCHAT_USER_ID=web:local
WEBCHAT_DISPLAY_NAME=Local
```

### 4. Build and restart

```bash
pnpm run build
pnpm exec nanoclaw-webchat verify    # optional
# restart your NanoClaw host service
```

### 5. Open the UI

```bash
open http://127.0.0.1:3200
```

The host injects `WEBCHAT_SECRET` into the page automatically (localhost-only; same model as the dashboard).

### Verify behavior

- **Lobby:** `@sarah hello` routes to the sarah agent
- **DM:** pick an agent in the sidebar
- **Threads:** use **New thread** in the lobby header

## Upgrading

```bash
pnpm update @artificer-innovations/nanoclaw-webchat
pnpm exec nanoclaw-webchat upgrade
pnpm run build
# restart host
```

| Change type | Action |
|-------------|--------|
| UI only | update package + restart host |
| Adapter / API | update package + `upgrade` + rebuild + restart |
| Skill docs | included in `upgrade` (runs `sync-skill`) |

See [CHANGELOG.md](./CHANGELOG.md) for breaking changes.

## MCP setup (optional)

Lets Cursor or other MCP clients post/read messages without the browser.

Prerequisite: webchat channel installed and host running on `:3200`.

```bash
pnpm add -D @artificer-innovations/nanoclaw-webchat-mcp
```

Add to Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "nanoclaw-webchat": {
      "command": "nanoclaw-webchat-mcp",
      "env": {
        "WEBCHAT_API_BASE": "http://127.0.0.1:3200",
        "WEBCHAT_SECRET": "<from your .env>"
      }
    }
  }
}
```

Tools: `webchat_list_channels`, `webchat_list_agents`, `webchat_read_channel`, `webchat_read_thread`, `webchat_send_message`, `webchat_create_thread`, `webchat_list_threads`.

Example workflow: list agents → send `@sarah review this` → poll `webchat_read_thread` with `since=` every 2–5 seconds.

Template: [packages/mcp/mcp.example.json](./packages/mcp/mcp.example.json)

## Uninstall

```bash
pnpm exec nanoclaw-webchat uninstall
pnpm remove @artificer-innovations/nanoclaw-webchat ws
pnpm remove -D @types/ws
pnpm run build
# restart host
```

See bundled [skills/add-webchat/REMOVE.md](./skills/add-webchat/REMOVE.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 401 in browser | Wrong `WEBCHAT_SECRET` |
| Blank page / 404 | `@artificer-innovations/nanoclaw-webchat` not installed or host not rebuilt |
| Agent not engaging in lobby | Message must include `@folder` (e.g. `@sarah`) |
| Port in use | Change `WEBCHAT_PORT` in `.env` |
| Package missing at build | Run `pnpm add @artificer-innovations/nanoclaw-webchat` |

## Testing before publish (developers)

Validate the full package locally **without npm publish**:

```bash
# 1. Build this monorepo
cd ~/Dev/nanoclaw-webchat
pnpm install && pnpm run build

# 2. Install into your fork from local path
cd ~/Dev/nanoclaw-v2
pnpm add file:../nanoclaw-webchat
pnpm exec nanoclaw-webchat install
pnpm run build
open http://127.0.0.1:3200
```

**Dry-run publish:**

```bash
cd ~/Dev/nanoclaw-webchat
pnpm pack
cd ~/Dev/nanoclaw-v2
pnpm add ../nanoclaw-webchat/artificer-innovations-nanoclaw-webchat-0.2.0.tgz
```

**UI hot reload** (adapter still from fork):

```bash
cd ~/Dev/nanoclaw-webchat
pnpm --filter @nanoclaw-webchat/client dev
# open http://localhost:5173 — proxies /api → 127.0.0.1:3200
```

**Full integration test (in-repo fixture):**

CI installs the CLI into `test/fixtures/nanoclaw-host` — a minimal bundled host skeleton. No external NanoClaw repo checkout.

```bash
cd ~/Dev/nanoclaw-webchat
pnpm run test:integration
```

Optional: regenerate the fixture after host DB API changes (requires a local NanoClaw fork):

```bash
NANOCLAW_SRC=../nanoclaw-v2 node scripts/prepare-host-fixture.mjs
```

After validation, switch to the registry version:

```bash
pnpm remove @artificer-innovations/nanoclaw-webchat
pnpm add @artificer-innovations/nanoclaw-webchat@0.2.0
```

## How this repo relates to your fork

- **nanoclaw-webchat** (this repo) → published to npm; source of truth for UI, adapter templates, skill, CLI, MCP
- **your NanoClaw fork** → adds the package as a dependency; adapter code is copied into `src/` at install time
- **nanoclaw-v2** (Artificer fork) → consumes the npm package; no longer maintains duplicate adapter source

Do not edit copied `src/webchat-*` files for permanent fixes — contribute changes here and re-run `upgrade`.

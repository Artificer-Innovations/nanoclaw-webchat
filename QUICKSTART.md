# NanoClaw Webchat — Quickstart

Install the browser web chat channel into an **existing, working NanoClaw fork**.

## Prerequisites

- A NanoClaw fork already running (agents, `.env`, host service)
- **Node.js 22 LTS** (matches package CI and verify). Node 26+ requires host `better-sqlite3@>=12.10.0`
- **pnpm** — the host fork already depends on **`better-sqlite3`** (native module used for webchat message storage)
- Claude Code (optional — for `/add-webchat`)

If `verify` fails with native module errors, the CLI (0.1.3+) auto-rebuilds under your project's Node version (`.nvmrc`). On first install, the CLI also scaffolds `.nvmrc` and a pnpm `onlyBuiltDependencies` hint for `better-sqlite3`.

## What gets installed where

| Piece | Location after install | Updates when you… |
|-------|------------------------|-------------------|
| npm package (UI + skill + adapter templates + MCP) | `node_modules/nanoclaw-webchat/` | `pnpm update nanoclaw-webchat` |
| Browser UI assets | served from `node_modules/.../dist/client/` at runtime | update package + restart host |
| Adapter code | copied into **your fork** `src/channels/web.ts`, `src/webchat-*.ts` | re-run `install` or `upgrade` |
| `/add-webchat` skill | `.claude/skills/add-webchat/` in your fork | `nanoclaw-webchat sync-skill` or `upgrade` |
| Message history | `data/webchat.db` in your fork | persists across upgrades |

You do **not** need to clone this repository beside your NanoClaw fork.

## First-time install

### 1. Add the npm package

```bash
cd ~/Dev/my-nanoclaw          # your NanoClaw fork
pnpm add nanoclaw-webchat@0.1.0 ws@8.18.3
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
pnpm exec nanoclaw-webchat verify    # recommended — runs adapter tests; handles native deps
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
pnpm update nanoclaw-webchat
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

Lets Cursor or other MCP clients post/read messages without the browser. The MCP server is bundled in the same `nanoclaw-webchat` package.

Prerequisite: webchat channel installed and host running on `:3200`.

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
pnpm remove nanoclaw-webchat ws
pnpm remove -D @types/ws
pnpm run build
# restart host
```

See bundled [skills/add-webchat/REMOVE.md](./skills/add-webchat/REMOVE.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 401 in browser | Wrong `WEBCHAT_SECRET` |
| Blank page / 404 | `nanoclaw-webchat` not installed or host not rebuilt |
| Agent not engaging in lobby | Message must include `@folder` (e.g. `@sarah`) |
| Port in use | Change `WEBCHAT_PORT` in `.env` |
| Package missing at build | Run `pnpm add nanoclaw-webchat` |
| `verify` fails: bindings / `NODE_MODULE_VERSION` | Run `pnpm exec nanoclaw-webchat verify` again (CLI rebuilds native deps). Install Node 22: `nvm install 22` |
| `verify` fails: Node 26 + better-sqlite3 11.x | Use Node 22, **or** `pnpm add better-sqlite3@^12.10.0` in the host fork |
| `verify` passes but host won't start | Check `WEBCHAT_SECRET`, run `pnpm run build`, restart the host service |

### If verify still fails (Mac + Homebrew Node)

Some Mac setups keep Homebrew Node ahead of nvm even after `nvm use`. Until your shell is fixed, run:

```bash
nvm exec 22 pnpm exec nanoclaw-webchat verify
```

Permanent fix: `brew unlink node`, or load nvm after Homebrew in `~/.zshrc`.

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
pnpm add ../nanoclaw-webchat/nanoclaw-webchat-0.1.0.tgz
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
pnpm remove nanoclaw-webchat
pnpm add nanoclaw-webchat@0.1.0
```

## How this repo relates to your fork

- **nanoclaw-webchat** (this repo) → published to npm; source of truth for UI, adapter templates, skill, CLI, MCP
- **your NanoClaw fork** → adds the package as a dependency; adapter code is copied into `src/` at install time
- **nanoclaw-v2** (Artificer fork) → consumes the npm package; no longer maintains duplicate adapter source

Do not edit copied `src/webchat-*` files for permanent fixes — contribute changes here and re-run `upgrade`.

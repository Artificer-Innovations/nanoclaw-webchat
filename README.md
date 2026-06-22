# @artificer-innovations/nanoclaw-webchat

Browser UI, NanoClaw **web chat** channel adapter, and `/add-webchat` skill — talk to your agents from a local tab with lobby `@mentions`, per-agent DMs, and threading.

**→ [QUICKSTART.md](./QUICKSTART.md)** — install into an existing NanoClaw fork, upgrade, and local pre-publish testing.

## What's in the package

| Component | Purpose |
|-----------|---------|
| Browser UI | React SPA served by the adapter via `getAssetDir()` |
| Adapter templates | Copied into your NanoClaw fork's `src/` by `/add-webchat` |
| `/add-webchat` skill | Claude Code install flow (bundled under `skills/add-webchat/`) |
| CLI | `nanoclaw-webchat install` / `upgrade` / `verify` (automation + CI) |
| MCP server | Separate package `@artificer-innovations/nanoclaw-webchat-mcp` |

## Architecture

```
Browser UI  ←HTTP/WS→  web.ts adapter (in your fork)  →  NanoClaw router  →  agents
MCP server  ←REST──→  same adapter
```

See [api-contract.md](./api-contract.md) for the REST/WebSocket API.

## Quick install (NanoClaw fork)

```bash
cd /path/to/your-nanoclaw-fork
pnpm add @artificer-innovations/nanoclaw-webchat ws
pnpm exec nanoclaw-webchat sync-skill
/add-webchat    # in Claude Code, or: pnpm exec nanoclaw-webchat install
```

Open `http://127.0.0.1:3200` after building and restarting the host.

Full steps: **[QUICKSTART.md](./QUICKSTART.md)**

## Development (this repo)

```bash
pnpm install
pnpm run typecheck
pnpm run test:coverage
pnpm run build
pnpm --filter @nanoclaw-webchat/client dev   # Vite → proxies /api to :3200
```

Test against a local NanoClaw fork without publishing:

```bash
cd ../nanoclaw-v2
pnpm add file:../nanoclaw-webchat
pnpm exec nanoclaw-webchat install
```

See QUICKSTART § *Testing before publish*.

## Branches & releases

Single long-lived **`main`** branch. Published as npm packages:

- `@artificer-innovations/nanoclaw-webchat`
- `@artificer-innovations/nanoclaw-webchat-mcp`

Release notes: [CHANGELOG.md](./CHANGELOG.md)

## License

MIT — Copyright (c) 2026 [Artificer Innovations, LLC](https://github.com/Artificer-Innovations)

See [LICENSE](./LICENSE).

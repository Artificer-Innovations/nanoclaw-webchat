# @artificer-innovations/nanoclaw-webchat

Browser UI for the NanoClaw **web chat** channel. Talk to your agents from a local tab — lobby with `@mentions`, per-agent DMs, and threading.

This package is **UI only**. Message routing runs through NanoClaw's `web` channel adapter (installed via the `/add-webchat` skill).

## Install

```bash
pnpm install @artificer-innovations/nanoclaw-webchat
```

The host adapter serves the built assets from this package and exposes the [API contract](./api-contract.md).

## Development

```bash
pnpm install
pnpm run dev      # Vite dev server (needs a running adapter for API)
pnpm run build
pnpm run typecheck
pnpm run test:coverage
```

### Branches & releases

This repository uses a **single long-lived `main` branch**. It is published as an npm package (`@artificer-innovations/nanoclaw-webchat`) and does **not** follow the org-wide `develop` → `main` SDLC used by application repos.

- Open pull requests against **`main`**
- CI runs on pushes and PRs to `main` (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml))
- There is no `develop` branch in this repo by design

## Usage

1. Install the `/add-webchat` skill in your NanoClaw fork.
2. Set `WEBCHAT_ENABLED=true` and `WEBCHAT_SECRET=…` in `.env`.
3. Open `http://127.0.0.1:3200` and paste the secret when prompted.

### Lobby

Type `@sarah review this` in the lobby — only the agent whose folder matches the pattern engages (per NanoClaw wiring). Once an agent has been @'d in a thread, they keep receiving follow-up messages in that thread without being @'d again.

### DMs

Pick an agent from the sidebar DM list. Every message goes to that agent (`engage_pattern: '.'`).

### Threads

Use **New thread** in the header. Each thread gets its own session on threaded adapters.

## MCP server

The [`mcp/`](./mcp/) package exposes a stdio MCP server so Cursor and other MCP clients can interact with web channels without the browser UI — similar to Slack MCP.

### Setup

1. Build the MCP server:

```bash
pnpm install
pnpm --filter @artificer-innovations/nanoclaw-webchat-mcp build
```

2. Add to Cursor MCP settings (`.cursor/mcp.json` or global config):

```json
{
  "mcpServers": {
    "nanoclaw-webchat": {
      "command": "node",
      "args": ["/absolute/path/to/nanoclaw-webchat/mcp/dist/index.js"],
      "env": {
        "WEBCHAT_API_BASE": "http://127.0.0.1:3200",
        "WEBCHAT_SECRET": "your-secret-from-nanoclaw-env"
      }
    }
  }
}
```

See [`mcp/mcp.example.json`](./mcp/mcp.example.json) for a template.

### Tools

| Tool | Purpose |
|------|---------|
| `webchat_list_channels` | List lobby and DM rooms |
| `webchat_list_agents` | List agents with `@mention` and DM platform IDs |
| `webchat_read_channel` | Read main-thread messages |
| `webchat_read_thread` | Read a specific thread |
| `webchat_send_message` | Post a message (optional attachments via local paths) |
| `webchat_create_thread` | Create a server-side thread |
| `webchat_list_threads` | List threads for a channel |

### Typical workflow

1. `webchat_list_agents` — pick an agent or use `lobby`
2. `webchat_create_thread` — optional, for an isolated session
3. `webchat_send_message` — e.g. `@sarah review this diff`
4. `webchat_read_thread` with `since=<timestamp from send>` — poll until agent replies appear

## License

MIT — Copyright (c) 2026 [Artificer Innovations, LLC](https://github.com/Artificer-Innovations)

See [LICENSE](./LICENSE).

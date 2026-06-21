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

## License

MIT — Copyright (c) 2026 [Artificer Innovations, LLC](https://github.com/Artificer-Innovations)

See [LICENSE](./LICENSE).

# Changelog

## 0.1.3

### Added

- **CLI verify preflight** — `nanoclaw-webchat verify` probes `better-sqlite3`, auto-rebuilds under the project's Node version (`.nvmrc`), and runs vitest with the same Node when your shell is on a different major (nvm/fnm/mise bin path or `nvm exec` fallback).
- **Install scaffolding** — `install` / `upgrade` create `.nvmrc` (Node 22) and append pnpm `onlyBuiltDependencies[]=better-sqlite3` to `.npmrc` when missing.

### Fixed

- **Node version mismatch** — Mac users with Homebrew Node 26 and nvm Node 22 no longer need manual `nvm exec 22 npm rebuild better-sqlite3`; verify handles it automatically.

## 0.1.2

### Fixed

- **CLI (`install` / `upgrade`)** — Entry detection now compares `realpath`-resolved paths instead of literal `argv[1]`. Fixes a silent no-op when running `pnpm exec nanoclaw-webchat install` or `upgrade` against a `file:` dependency (pnpm resolves the bin through symlinks).
- **Host fork compatibility** — Adapter tests copied into a host fork's `src/` now compile under strict `tsc`:
  - `webchat-sync.test.ts`: use `vi.mocked(readEnvFile)` so mocks are not referenced before initialization (TDZ/hoisting failure during `verify`).
  - `web.test.ts`: type the `Buffer.from` spy with an `unknown` delegate and `bind(Buffer)` so overload/tuple errors do not fail host builds.
- **`nanoclaw-webchat verify`** — `webchat-sync.test.ts` mocks `DATA_DIR` to a temp directory and resets schema in `beforeEach`, so tests no longer write to the host's persistent `data/webchat.db` and hit `UNIQUE constraint failed: web_messages.id`.
- **Integration CI** — Web adapter tests reserve an OS-assigned port per test instead of a fixed incrementing counter, flush agent deliveries before teardown, and integration runs with `fileParallelism: false`. Fixes flaky `listen EADDRINUSE` failures in CI.

## 0.1.1

### Fixed

- Root package entry now exports `getAssetDir()` so host forks can compile and serve UI assets from the npm install. Fixes build failure `Property 'getAssetDir' does not exist` after installing from the registry.

## 0.1.0

Initial public release.

### Added

- Browser UI: lobby with `@mention` routing, per-agent DMs, threading, engaged agents, attachments, markdown, light/dark theme
- NanoClaw web channel adapter (`packages/adapter`) installed into host forks via CLI or `/add-webchat` skill
- `nanoclaw-webchat` CLI: `install`, `upgrade`, `sync-skill`, `verify`, `uninstall`
- Bundled MCP server (`nanoclaw-webchat-mcp` bin) for Cursor and other MCP clients
- `/add-webchat` skill bundled under `skills/add-webchat/`
- Integration CI against bundled NanoClaw host fixture

### Package

- Published as unscoped npm package **`nanoclaw-webchat`**
- Monorepo layout: `packages/client`, `packages/adapter`, `packages/shared`, `packages/cli`, `packages/mcp`

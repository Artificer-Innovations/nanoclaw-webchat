# Changelog

## 0.4.0

### Minor Changes

- Add live agent activity timeline for nanoclaw-agenttrace (per-agent rows, typing keepalives, cleaned stream text), and skip peer fan-out for provider session-limit / error notices so quota messages do not amplify across lobby agents.

### Patch Changes

- 55f524f: Fix `webchat-boot` create_agent live refresh for current NanoClaw guarded delivery APIs (`createAgent`, `validateCreateAgent`, `requestCreateAgentHold`, `reenterGuardedDeliveryAction`) instead of removed `applyCreateAgent` / `handleCreateAgent` exports.

## 0.3.0

### Minor Changes

- Add MCP OAuth 2.1 for co-hosted Streamable HTTP MCP at `/mcp`, issuing per-user bearer tokens from public auth sessions while keeping stdio MCP + `WEBCHAT_SECRET` for local admin.

- [#43](https://github.com/Artificer-Innovations/nanoclaw-webchat/pull/43) [`340e726`](https://github.com/Artificer-Innovations/nanoclaw-webchat/commit/340e7260b5a56ed84a9a149d55aa0d232e87ff5a) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Add `WEBCHAT_PUBLIC_PATH` so reverse-proxy path mounts (e.g. `/webchat` with stripPrefix) rewrite `/api` and `/assets` in served SPA assets and post-login redirects.

### Patch Changes

- Fix public-mode create-agent approvals (global owner + authz pre-check) and re-sync live channel wirings after agent bootstrap.

- Backfill per-user inbox and DM wirings on boot in public auth mode so existing users see agent DMs without re-login.

- Fix MCP OAuth session stickiness (bearer `expiresAt`, loopback localhost/`127.0.0.1` matching) and refresh connected clients on agent create and delete.

- [#44](https://github.com/Artificer-Innovations/nanoclaw-webchat/pull/44) [`3a0e6ef`](https://github.com/Artificer-Innovations/nanoclaw-webchat/commit/3a0e6ef5f82ca34d5b88615c01886e015f01dde5) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Prefix attachment API URLs with `WEBCHAT_PUBLIC_PATH` so open/download works under reverse-proxy path mounts.

## 0.2.1

### Patch Changes

- [#35](https://github.com/Artificer-Innovations/nanoclaw-webchat/pull/35) [`d73b1e1`](https://github.com/Artificer-Innovations/nanoclaw-webchat/commit/d73b1e18b20c2849a6d2d0f460b17d7f67fbb28d) Thanks [@ZappoMan](https://github.com/ZappoMan)! - Fix OIDC provider test fixture missing required `scopes` field so host `tsc` builds succeed after adapter install.

## 0.2.0

### Added

- **Public authentication** — Optional `WEBCHAT_AUTH_MODE=public` for network-facing deployments: shared-password (basic) login, OIDC/OAuth (RS256/ES256 id_token verification, JWKS rotation retry), signed session cookies, per-user inbox/DM room scoping, and Sign out. Local mode unchanged. See [docs/public-auth.md](docs/public-auth.md).
- **Interactive inbox approvals** — Approval cards in the Inbox with claim-first dispatch to prevent double actions; session state mirrors host approvals.
- **Multipart attachment uploads** — Streamed uploads up to 1 GB with resumable chunked endpoint, Range request support for serve, and upload-referenced attachments in messages.
- **Video and audio attachments** — In-browser previews with MIME normalization (parameter stripping) and codec fallbacks.
- **Attachment preview improvements** — Typed attachment chips, HEIC fallbacks, and improved URL-based attachment display.

### Fixed

- **Upload edge cases** — Rollback boundary with `movedCount`, suffix Range support, and streaming serve hardening.
- **Flaky WebSocket tests** — Stabilized App WebSocket tests on slow CI runners.
- **Public auth hardening** — JWT expiry enforcement, cross-user room access checks, unconditional basic-login password compare, and shared auth DB connection reuse.

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

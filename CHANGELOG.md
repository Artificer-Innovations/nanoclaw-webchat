# Changelog

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

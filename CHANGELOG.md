# Changelog

## 0.2.0

### Added

- Monorepo layout: `packages/client`, `packages/adapter`, `packages/shared`, `packages/cli`, `packages/mcp`
- `/add-webchat` skill bundled in npm package (`skills/add-webchat/`)
- `nanoclaw-webchat` CLI: `install`, `upgrade`, `sync-skill`, `verify`, `uninstall`
- [QUICKSTART.md](./QUICKSTART.md) end-user install and upgrade guide
- Integration CI job against a pinned NanoClaw fork

### Changed

- Adapter source of truth moves from NanoClaw fork into this repo (`packages/adapter`)
- MCP server lives at `packages/mcp` and shares types via `packages/shared`
- Published package includes skill resources, CLI bin, and documentation

### Upgrade notes

- **From 0.1.x:** `pnpm update @artificer-innovations/nanoclaw-webchat` then `pnpm exec nanoclaw-webchat upgrade` in your NanoClaw fork, rebuild, and restart the host.
- UI-only changes may only require a host restart after updating the npm package.
- Adapter changes require re-running `install` or `upgrade`.

## 0.1.0

- Initial browser UI package with `getAssetDir()` export

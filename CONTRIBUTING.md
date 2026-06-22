# Contributing to nanoclaw-webchat

Thank you for contributing. This repo is the npm package that adds a browser web chat channel to [NanoClaw](https://github.com/Artificer-Innovations/nanoclaw-v2) forks — it is not the NanoClaw host itself.

## Prerequisites

- Node.js ≥ 20
- pnpm 9

## Branch flow

| Branch | Purpose |
|--------|---------|
| **`develop`** | Integration branch — open feature and fix PRs here |
| **`main`** | Release branch — merge `develop` → `main` to publish |

## Local development

```bash
pnpm install
pnpm run typecheck
pnpm run test:coverage
pnpm run build
pnpm run test:integration   # optional — full host fixture
pnpm --filter @nanoclaw-webchat/client dev   # UI hot reload → :5173
```

Before pushing, run the full pre-push sequence:

```bash
pnpm run typecheck
pnpm run test:unit
pnpm run test:coverage
```

## Monorepo layout

| Path | Role |
|------|------|
| `packages/client` | React browser UI (Vite) |
| `packages/adapter` | NanoClaw channel adapter source (synced into `skills/` at build) |
| `packages/cli` | `nanoclaw-webchat` install/upgrade CLI |
| `packages/mcp` | MCP server (bundled in npm package as `nanoclaw-webchat-mcp`) |
| `packages/shared` | Shared TypeScript types (private workspace package) |
| `skills/add-webchat` | Claude Code `/add-webchat` install skill |

The legacy root `src/` directory is not part of the build — use `packages/client/src/`.

## Changesets

User-facing changes to the published `nanoclaw-webchat` package need a changeset:

```bash
pnpm changeset
```

See [.changeset/README.md](./.changeset/README.md) for the release flow.

## Where to make changes

- **UI bugs/features** → `packages/client`
- **Adapter / API / routing** → `packages/adapter` (re-run `pnpm run build` to sync skill resources)
- **Install flow** → `packages/cli` and `skills/add-webchat`
- **MCP tools** → `packages/mcp`

Do not patch copied files in a user's NanoClaw fork permanently — fix here and ship via npm.

## Reporting issues

Open a [GitHub issue](https://github.com/Artificer-Innovations/nanoclaw-webchat/issues). For security concerns, see [SECURITY.md](./SECURITY.md).

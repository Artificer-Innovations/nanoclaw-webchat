# Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for semver releases.

## When to add a changeset

Add a changeset when your PR includes **user-facing** changes to the published `nanoclaw-webchat` package (UI, adapter, CLI, MCP, skill, or docs shipped in the npm tarball).

```bash
pnpm changeset
```

Choose patch / minor / major and write a short summary. Commit the generated file under `.changeset/`.

## Release flow

1. Feature PRs merge into **`develop`**
2. Run `pnpm version` on `develop` to apply pending changesets (bumps `package.json` + `CHANGELOG.md`)
3. Open a release PR: **`develop` → `main`**
4. Merge to **`main`** — CI publishes to npm and creates a GitHub Release

Private workspace packages (`@nanoclaw-webchat/*`) are ignored by Changesets; only the root package is published.

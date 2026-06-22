## Summary

<!-- What changed and why? -->

## Test plan

- [ ] `pnpm run typecheck`
- [ ] `pnpm run test:coverage`
- [ ] `pnpm run build` (if build or packaging changed)
- [ ] Manual verification (if UI/adapter behavior changed)

## Base branch

- [ ] This PR targets **`develop`** (feature/fix work)
- [ ] This PR targets **`main`** (release: `develop` → `main`)

Feature and fix PRs should target **`develop`**. Release PRs merge **`develop` into `main`** to trigger npm publish and GitHub Releases. See [README § Branches & releases](../README.md#branches--releases).

## Changeset

- [ ] Changeset added (if this changes user-facing behavior in the published `nanoclaw-webchat` package)
- [ ] Not needed (docs-only / internal / CI-only)

Run `pnpm changeset` locally when semver should bump on the next release.

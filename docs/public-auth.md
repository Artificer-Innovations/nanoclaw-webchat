# Public authentication setup

By default, nanoclaw-webchat runs in **local mode**: the adapter binds to `127.0.0.1`, injects `WEBCHAT_SECRET` into the served HTML, and treats every browser tab as one trusted operator.

**Public mode** is for deployments where users reach the UI over a network (VPN, tailnet, or the public internet). It adds:

- A **login page** (shared password and/or OIDC/OAuth providers such as GitHub)
- **Signed session cookies** instead of an embedded bearer token in HTML
- **Per-user room scoping**: shared lobby, private inbox, and per-user DMs
- A **Sign out** button in the sidebar footer

Local mode is unchanged when `WEBCHAT_AUTH_MODE` is omitted or set to `local`.

## Which mode should I use?

There are three ways to run the UI. Pick based on who reaches it and how much you trust them.

**Local mode** is for a single operator on the same machine. The adapter binds to localhost and injects the token into the page, so there is no login at all. Use it for solo local development and personal use.

**Basic (shared password)** is for a small group of people you already trust, reaching the UI over a private network such as a VPN or tailnet. It is the fastest path: one shared password and a fixed list of usernames, with no OAuth app and no external identity provider. The tradeoff is that the username is self-asserted. Anyone who knows the shared password can sign in under any allowed username, so people are kept apart for convenience (separate inboxes, distinct lobby labels) rather than separated from one another by a real credential. Choose it when everyone who holds the password is trusted not to impersonate the others and you want the lowest possible setup cost.

**OIDC / OAuth** gives real per-person identity backed by an identity provider (GitHub, Google, Okta, and so on). Each person signs in with their own provider account, and you gate access with an allowlist on verified email domain, exact email, or provider subject. Choose it for anything internet-facing, anywhere you need to know who did what, or anywhere you need to add and remove individuals without rotating a shared secret.

| | Local | Basic (shared password) | OIDC / OAuth |
|---|---|---|---|
| Login | none (localhost token) | username + one shared password | provider account |
| Identity source | single operator | self-asserted username | verified by the IdP |
| Per-user inbox/DMs | not applicable | yes, keyed by username | yes, keyed by provider subject |
| Revoke one person | not applicable | rotate the shared password (signs everyone out) | remove from the allowlist (no impact on others) |
| Setup cost | none | low | moderate (register an OAuth app or IdP) |
| Best for | solo local dev | small trusted team on VPN/tailnet | internet-facing or audited multi-user |

You can also run basic and OIDC together. See [Example: basic + GitHub together](#example-basic--github-together).

## Prerequisites

Complete the normal [QUICKSTART](../QUICKSTART.md) install first. Public auth builds on the same adapter copy and host `.env` file.

You will need:

- A **session signing secret** (`WEBCHAT_SESSION_SECRET`), unrelated to `WEBCHAT_SECRET`
- At least one login method: **basic password** and/or **OIDC/OAuth**
- For OIDC: provider credentials and a **callback URL** registered with the provider
- For internet-facing hosts: **HTTPS** in front of the app (reverse proxy or load balancer)

## Quick reference: environment variables

| Variable | Required (public) | Description |
|----------|-------------------|-------------|
| `WEBCHAT_AUTH_MODE` | yes | Set to `public` |
| `WEBCHAT_SESSION_SECRET` | yes | Random secret for signing session cookies. Minimum 32 characters, enforced at startup. A 32-byte hex value is recommended |
| `WEBCHAT_SECURE_COOKIES` | no | `true`/`false` override. Public mode defaults to `Secure` cookies regardless of `NODE_ENV` |
| `WEBCHAT_SESSION_INSECURE_COOKIES` | no | Set `true` for local HTTP dev without TLS (disables the `Secure` flag) |
| `WEBCHAT_SECRET` | yes | Still required. Used for MCP/automation bearer access and host wiring |
| `WEBCHAT_BIND_ADDRESS` | recommended | `0.0.0.0` to listen on all interfaces. Default `127.0.0.1` |
| `WEBCHAT_AUTH_BASIC_ENABLED` | one of basic/OIDC | `true` to enable shared-password login |
| `WEBCHAT_BASIC_PASSWORD` | if basic enabled | The single shared password for all allowed usernames |
| `WEBCHAT_BASIC_ALLOWED_USERNAMES` | if basic enabled | Comma-separated usernames (e.g. `alice,bob`) |
| `WEBCHAT_BASIC_DISPLAY_NAMES` | no | Optional `user:Display Name` pairs (e.g. `alice:Alice,bob:Bob`) |
| `WEBCHAT_AUTH_OIDC_ENABLED` | one of basic/OIDC | `true` to enable OIDC/OAuth providers |
| `WEBCHAT_OIDC_REDIRECT_URI` | if OIDC enabled | Must match the provider callback, e.g. `https://chat.example.com/api/auth/callback` |
| `WEBCHAT_OIDC_PROVIDERS` | if OIDC enabled | Inline JSON array of providers (see below) |
| `WEBCHAT_OIDC_PROVIDERS_FILE` | alternative | Path to a JSON file (same schema as inline) |
| `WEBCHAT_SESSION_TTL_SECONDS` | no | Session lifetime (default `86400` = 24 hours) |
| `WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS` | recommended | Comma-separated email domains (verified email required) |
| `WEBCHAT_OIDC_ALLOWED_EMAILS` | optional | Comma-separated exact emails |
| `WEBCHAT_OIDC_ALLOWED_SUBS` | optional | Comma-separated `providerId:numericSub` (e.g. `github:12345678`) |
| `WEBCHAT_OIDC_REQUIRED_GROUP` | optional | OIDC `groups` claim must include this value |
| `WEBCHAT_MCP_HTTP_ENABLED` | no | `true`/`false`. Defaults to `true` in public mode, `false` in local mode. Enables co-hosted Streamable HTTP MCP at `/mcp` with OAuth login |
| `WEBCHAT_MCP_TOKEN_TTL_SECONDS` | no | MCP access-token lifetime in seconds (default `86400` / 24h). Refresh grants are not supported yet |
| `WEBCHAT_PUBLIC_BASE_URL` | when MCP HTTP enabled | Canonical public origin (e.g. `https://chat.example.com`). Derived from `WEBCHAT_OIDC_REDIRECT_URI` when unset |

Generate secrets:

```bash
# Session signing secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# WEBCHAT_SECRET (if you do not already have one)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

## Example: basic password only

Good for a small team behind a VPN or tailnet where you do not want to run an OAuth app.

```bash
WEBCHAT_ENABLED=true
WEBCHAT_PORT=3200
WEBCHAT_SECRET=<random-hex>
WEBCHAT_AUTH_MODE=public
WEBCHAT_SESSION_SECRET=<long-random-secret>
WEBCHAT_BIND_ADDRESS=0.0.0.0

WEBCHAT_AUTH_BASIC_ENABLED=true
WEBCHAT_BASIC_PASSWORD=<shared-team-password>
WEBCHAT_BASIC_ALLOWED_USERNAMES=alice,bob
WEBCHAT_BASIC_DISPLAY_NAMES=alice:Alice,bob:Bob
```

After restart, open the UI and you should see a login form with a username field and a password field.

### How basic auth works

The server admits a login when the username is in `WEBCHAT_BASIC_ALLOWED_USERNAMES` **and** the password equals the single shared `WEBCHAT_BASIC_PASSWORD`. There is no separate per-user password. On success the user receives a signed session cookie, a private inbox and DM scope keyed to `web:basic:<username>`, and a lobby sender label drawn from `WEBCHAT_BASIC_DISPLAY_NAMES` (falling back to the username).

### What this means in practice

The shared password is the only secret. The username is a label and a room key, not a credential. Keep these properties in mind:

- **Usernames are self-asserted.** Anyone who knows the shared password can sign in under any name in the allowlist. People are kept in separate inboxes and given distinct lobby labels for convenience, not isolated from each other by authentication.
- **Revocation is all-or-nothing.** Removing a name from `WEBCHAT_BASIC_ALLOWED_USERNAMES` stops it from being a valid login option, but it does not stop someone who still knows the password from signing in under a different allowed name. To actually cut a person off, rotate `WEBCHAT_BASIC_PASSWORD`, which signs everyone out.
- **Allowlist checks are timing-safe.** Usernames are compared against the full allowlist with constant-time equality, so response timing does not reveal which names are valid. Basic mode is still not meant to stand alone on the open internet because the shared password is the only secret and usernames remain self-asserted.

Use basic mode when you have a small trusted group on a private network and want zero external dependencies. Prefer OIDC when the host is internet-facing, when you need to revoke one person without disrupting everyone, or when you need an audit trail of who took which action.

## Example: GitHub OAuth

### 1. Create a GitHub OAuth App

GitHub then **Settings then Developer settings then OAuth Apps then New OAuth App**

| Field | Value |
|-------|--------|
| **Authorization callback URL** | Must equal `WEBCHAT_OIDC_REDIRECT_URI` exactly |

Example for local testing with a tunnel:

```
https://your-subdomain.example.com/api/auth/callback
```

### 2. Configure the host

Save providers to a file (recommended) or inline JSON.

`oidc-providers.json`:

```json
[
  {
    "id": "github",
    "label": "Sign in with GitHub",
    "protocol": "oauth",
    "authorizationUrl": "https://github.com/login/oauth/authorize",
    "tokenUrl": "https://github.com/login/oauth/access_token",
    "clientId": "YOUR_GITHUB_CLIENT_ID",
    "clientSecret": "YOUR_GITHUB_CLIENT_SECRET"
  }
]
```

`.env`:

```bash
WEBCHAT_ENABLED=true
WEBCHAT_PORT=3200
WEBCHAT_SECRET=<random-hex>
WEBCHAT_AUTH_MODE=public
WEBCHAT_SESSION_SECRET=<long-random-secret>
WEBCHAT_BIND_ADDRESS=0.0.0.0

WEBCHAT_AUTH_OIDC_ENABLED=true
WEBCHAT_OIDC_REDIRECT_URI=https://chat.example.com/api/auth/callback
WEBCHAT_OIDC_PROVIDERS_FILE=/path/to/oidc-providers.json

# Restrict who can sign in (strongly recommended)
WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS=yourcompany.com
```

**Important:** the provider `"id"` must be `"github"` for GitHub. The adapter uses GitHub-specific profile/email lookup for that id rather than an OIDC id_token, so the JWKS notes below do not apply to the GitHub path.

Default OAuth scopes are `read:user user:email`.

**Access is gated by the allowlist, not by signing in.** With no `WEBCHAT_OIDC_ALLOWED_*` rules set, any account that completes the provider flow is admitted. Set at least one allowlist rule before exposing the host.

**Admitted users are owners.** Public-mode login (basic or OIDC) grants the global `owner` role for that web identity so the same person can approve inbox cards (`create_agent`, package installs, and so on). You do not need to discover opaque ids like `web:github:2093195` ahead of time — the allowlist is the privilege gate. An empty OIDC allowlist therefore admits *and* owns anyone who completes OAuth; keep allowlist rules tight on internet-facing hosts.

> **Multi-user follow-up:** every admitted user becomes a global owner (`agent_group_id: null`). That is intentional for solo and trusted-team hosts, but a broad domain allowlist (`WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS`) would make every matching employee an org-wide owner with no member tier. Track a privilege-tier before advertising domain-allowlist multi-user deployments.

### 3. Generic OIDC (Google, Okta, etc.)

Use `"protocol": "oidc"` and set `"issuer"` to the provider's issuer URL (the discovery document is fetched automatically):

```json
[
  {
    "id": "google",
    "label": "Sign in with Google",
    "protocol": "oidc",
    "issuer": "https://accounts.google.com",
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET"
  }
]
```

Register the same `WEBCHAT_OIDC_REDIRECT_URI` as the authorized redirect URI in your IdP.

For generic OIDC providers the adapter fetches the provider JWKS and verifies the id_token signature, along with `exp`, `nbf`, audience, and issuer, before trusting any claims. Both **RS256 and ES256** (EC P-256) signatures are supported. Any other algorithm fails closed and the login is rejected.

If the provider rotates its signing keys, a signature failure or a missing signing key clears the cached JWKS and refetches it once before rejecting, so a key rotation does not require a host restart. The JWKS cache is in-memory with no fixed TTL. The retry covers signature and key-selection failures only; expired, audience, and issuer errors are not retried.

## Example: basic + GitHub together

Enable both `WEBCHAT_AUTH_BASIC_ENABLED=true` and `WEBCHAT_AUTH_OIDC_ENABLED=true`. The login page shows the password form and provider buttons separated by "or".

## Room scoping in public mode

| Room | Visibility |
|------|------------|
| **Lobby** | Shared. All authenticated users see the same messages, and sender names identify who wrote each message |
| **Inbox** | Private per user (`web:<provider>:<sub>` or `web:basic:<username>`) |
| **DMs** | Private per user. Same agent folder, separate conversation per login |

The MCP server and other automation can still call the REST API with `Authorization: Bearer <WEBCHAT_SECRET>`. Treat that token as an admin/service credential, not an end-user session.

## MCP OAuth (Cursor and remote MCP clients)

In public mode, the web adapter co-hosts a **Streamable HTTP MCP** endpoint at `/mcp` on the same port as the UI. MCP clients (such as Cursor) discover OAuth via [Protected Resource Metadata](https://www.rfc-editor.org/rfc/rfc9728) and log in through the same browser session as the web UI.

| Mode | MCP transport | Auth |
|------|---------------|------|
| Local (default) | stdio `nanoclaw-webchat-mcp` | `WEBCHAT_SECRET` in env |
| Public | URL `https://<your-host>/mcp` | OAuth (browser login) |
| Public automation | REST API directly | `WEBCHAT_SECRET` admin bearer |

**Cursor config (public mode):**

```json
{
  "mcpServers": {
    "nanoclaw-webchat": {
      "url": "https://chat.example.com/mcp"
    }
  }
}
```

No secrets in the config — Cursor runs the OAuth flow and receives a per-user bearer token scoped to that login.

**Requirements:**

- `WEBCHAT_PUBLIC_BASE_URL` must match the URL users and MCP clients reach (including TLS termination at your reverse proxy)
- MCP HTTP is enabled by default in public mode (`WEBCHAT_MCP_HTTP_ENABLED=false` to disable)
- Access tokens last 24 hours by default (`WEBCHAT_MCP_TOKEN_TTL_SECONDS`); there is no refresh grant yet, so clients re-authorize when the token expires
- Rate-limit `/authorize`, `/token`, and `/register` at the reverse proxy (they hit SQLite before user auth)
- Local stdio MCP (`nanoclaw-webchat-mcp` with `WEBCHAT_SECRET`) is unchanged for solo dev
- Rotating `WEBCHAT_SESSION_SECRET` invalidates browser sessions and MCP tokens together

OAuth endpoints (same origin as the UI): `/authorize`, `/token`, `/register`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`.

When a new agent group is created (approved `create_agent` or `ncl groups create`), webchat re-syncs lobby/`@folder` and per-user DM wirings and pushes a soft bootstrap refresh over WebSocket so the new DM appears without restarting the host. A full page reload also heals wirings via `/api/bootstrap`.

## Migrating an existing deployment from local to public

Public mode scopes inbox and DM rooms per user under new internal room ids. Messages created in local mode live under the single local inbox id, so they will not appear once a host switches to public mode. To the newly scoped users, prior inbox and DM history looks empty.

Public sync also revokes owner/admin on the legacy local identity (`web:local` / `WEBCHAT_USER_ID`) so approval cards route to real logged-in users instead of the old shared inbox.

The lobby is shared in both modes, so lobby messages are not affected by per-user scoping. If you need the local inbox or DM history after the switch, export or copy it first, or keep a local-mode instance available for reference. New messages created in public mode are stored correctly under each user's scope.

## Production checklist

1. **HTTPS** terminate TLS at your reverse proxy. In public mode, session cookies are marked `Secure` by default (this no longer depends on `NODE_ENV`). For local HTTP dev without TLS, opt out explicitly with `WEBCHAT_SESSION_INSECURE_COOKIES=true`, or force the behavior either way with `WEBCHAT_SECURE_COOKIES`.
2. **Allowlist** set `WEBCHAT_OIDC_ALLOWED_*` or keep basic auth to a fixed username list. With no allowlist rules, any user who completes OAuth is admitted — and, in public mode, becomes an owner who can approve privileged actions.
3. **Secrets** store `WEBCHAT_SESSION_SECRET`, `WEBCHAT_SECRET`, OAuth client secrets, and `WEBCHAT_BASIC_PASSWORD` in your secret manager, not in git. `WEBCHAT_SESSION_SECRET` must be at least 32 characters; the host refuses to start otherwise.
4. **Bind address** use `WEBCHAT_BIND_ADDRESS=0.0.0.0` only when the host firewall and network policy restrict who can reach the port.
5. **Upgrade** after updating the npm package, run `pnpm exec nanoclaw-webchat upgrade` so auth adapter files stay in sync.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Login page never appears | `WEBCHAT_AUTH_MODE` not `public`, or the browser still has the injected local token meta. Hard refresh |
| "Access denied" after OAuth | The allowlist rejected the user (unverified email, wrong domain, and so on) |
| Redirect mismatch | GitHub/IdP callback URL does not equal `WEBCHAT_OIDC_REDIRECT_URI` |
| No GitHub button | `WEBCHAT_AUTH_OIDC_ENABLED` not `true`, or invalid/missing providers JSON |
| Host fails to start | Missing `WEBCHAT_SESSION_SECRET`, secret shorter than 32 characters, missing OIDC redirect URI, or basic auth enabled without a password or usernames |
| Everyone still labeled "You" in lobby | Hard refresh after upgrade, and confirm messages persist `senderName` / `senderId` (upgrade the adapter) |
| Inbox/DM history empty after switching from local to public | Expected. Public mode scopes those rooms per user under new ids. See [Migrating an existing deployment](#migrating-an-existing-deployment-from-local-to-public) |
| OIDC login fails with an unsupported-algorithm error | The provider signs id_tokens with something other than RS256 or ES256. Those two are supported; anything else is rejected |
| Approve shows success but agent is not created | Stale card targeted at legacy `web:local`. Sign out/in once after upgrade, then re-request `create_agent`. UI should return **403 not authorized** for wrong-identity clicks |
| New agent DM missing until host restart | Upgrade adapter (live rewire). Hard refresh also heals via `/api/bootstrap`. Confirm `WEBCHAT_ENABLED=true` |

## Auth HTTP endpoints

Used by the browser UI. You normally do not call these directly.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/auth/config` | Login options (basic enabled, provider list) |
| `GET` | `/api/auth/me` | Current session user |
| `POST` | `/api/auth/login/basic` | Username + password login |
| `GET` | `/api/auth/login?provider=<id>` | Start OIDC/OAuth redirect |
| `GET` | `/api/auth/callback` | OAuth callback (register this URL with the provider) |
| `POST` | `/api/auth/logout` | Clear the session cookie |

See [SECURITY.md](../SECURITY.md) for threat-model notes and [api-contract.md](../api-contract.md) for the chat REST/WebSocket API.

# Public authentication setup

By default, nanoclaw-webchat runs in **local mode**: the adapter binds to `127.0.0.1`, injects `WEBCHAT_SECRET` into the served HTML, and treats every browser tab as one trusted operator.

**Public mode** is for deployments where users reach the UI over a network (VPN, tailnet, or the public internet). It adds:

- A **login page** (shared password and/or OIDC/OAuth providers such as GitHub)
- **Signed session cookies** instead of an embedded bearer token in HTML
- **Per-user room scoping** — shared lobby, private inbox, and per-user DMs
- A **Sign out** button in the sidebar footer

Local mode is unchanged when `WEBCHAT_AUTH_MODE` is omitted or set to `local`.

## Prerequisites

Complete the normal [QUICKSTART](../QUICKSTART.md) install first. Public auth builds on the same adapter copy and host `.env` file.

You will need:

- A **session signing secret** (`WEBCHAT_SESSION_SECRET`) — unrelated to `WEBCHAT_SECRET`
- At least one login method: **basic password** and/or **OIDC/OAuth**
- For OIDC: provider credentials and a **callback URL** registered with the provider
- For internet-facing hosts: **HTTPS** in front of the app (reverse proxy or load balancer)

## Quick reference — environment variables

| Variable | Required (public) | Description |
|----------|-------------------|-------------|
| `WEBCHAT_AUTH_MODE` | yes | Set to `public` |
| `WEBCHAT_SESSION_SECRET` | yes | Random secret for signing session cookies (minimum 32 characters; 32-byte hex recommended) |
| `WEBCHAT_SECURE_COOKIES` | no | `true`/`false` override; public mode defaults to `Secure` cookies |
| `WEBCHAT_SESSION_INSECURE_COOKIES` | no | Set `true` for local HTTP dev without TLS (disables `Secure` flag) |
| `WEBCHAT_SECRET` | yes | Still required — used for MCP/automation bearer access and host wiring |
| `WEBCHAT_BIND_ADDRESS` | recommended | `0.0.0.0` to listen on all interfaces; default `127.0.0.1` |
| `WEBCHAT_AUTH_BASIC_ENABLED` | one of basic/OIDC | `true` to enable shared-password login |
| `WEBCHAT_BASIC_PASSWORD` | if basic enabled | Shared password for allowed usernames |
| `WEBCHAT_BASIC_ALLOWED_USERNAMES` | if basic enabled | Comma-separated usernames (e.g. `alice,bob`) |
| `WEBCHAT_BASIC_DISPLAY_NAMES` | no | Optional `user:Display Name` pairs (e.g. `alice:Alice,bob:Bob`) |
| `WEBCHAT_AUTH_OIDC_ENABLED` | one of basic/OIDC | `true` to enable OIDC/OAuth providers |
| `WEBCHAT_OIDC_REDIRECT_URI` | if OIDC enabled | Must match provider callback, e.g. `https://chat.example.com/api/auth/callback` |
| `WEBCHAT_OIDC_PROVIDERS` | if OIDC enabled | Inline JSON array of providers (see below) |
| `WEBCHAT_OIDC_PROVIDERS_FILE` | alternative | Path to a JSON file (same schema as inline) |
| `WEBCHAT_SESSION_TTL_SECONDS` | no | Session lifetime (default `86400` = 24 hours) |
| `WEBCHAT_OIDC_ALLOWED_EMAIL_DOMAINS` | recommended | Comma-separated email domains (verified email required) |
| `WEBCHAT_OIDC_ALLOWED_EMAILS` | optional | Comma-separated exact emails |
| `WEBCHAT_OIDC_ALLOWED_SUBS` | optional | Comma-separated `providerId:numericSub` (e.g. `github:12345678`) |
| `WEBCHAT_OIDC_REQUIRED_GROUP` | optional | OIDC `groups` claim must include this value |

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

After restart, open the UI — you should see a login form. Each allowed username signs in with the same shared password but gets their own inbox/DM scope and lobby sender label.

## Example: GitHub OAuth

### 1. Create a GitHub OAuth App

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**

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

**Important:** the provider `"id"` must be `"github"` for GitHub — the adapter uses GitHub-specific profile/email lookup for that id.

Default OAuth scopes are `read:user user:email`.

### 3. Generic OIDC (Google, Okta, etc.)

Use `"protocol": "oidc"` and set `"issuer"` to the provider's issuer URL (discovery document is fetched automatically):

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

## Example: basic + GitHub together

Enable both `WEBCHAT_AUTH_BASIC_ENABLED=true` and `WEBCHAT_AUTH_OIDC_ENABLED=true`. The login page shows the password form and provider buttons separated by “or”.

## Room scoping in public mode

| Room | Visibility |
|------|------------|
| **Lobby** | Shared — all authenticated users see the same messages; sender names identify who wrote each message |
| **Inbox** | Private per user (`web:<provider>:<sub>` or `web:basic:<username>`) |
| **DMs** | Private per user — same agent folder, separate conversation per login |

The MCP server and other automation can still call the REST API with `Authorization: Bearer <WEBCHAT_SECRET>`. Treat that token as an admin/service credential, not an end-user session.

## Production checklist

1. **HTTPS** — terminate TLS at your reverse proxy; set `NODE_ENV=production` so session cookies are marked `Secure`
2. **Allowlist** — set `WEBCHAT_OIDC_ALLOWED_*` or keep basic auth to a fixed username list; with no allowlist rules, any user who completes OAuth is admitted
3. **Secrets** — store `WEBCHAT_SESSION_SECRET`, `WEBCHAT_SECRET`, OAuth client secrets, and `WEBCHAT_BASIC_PASSWORD` in your secret manager, not in git
4. **Bind address** — `WEBCHAT_BIND_ADDRESS=0.0.0.0` only when the host firewall and network policy restrict who can reach the port
5. **Upgrade** — after updating the npm package, run `pnpm exec nanoclaw-webchat upgrade` so auth adapter files stay in sync

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Login page never appears | `WEBCHAT_AUTH_MODE` not `public`, or browser still has injected local token meta — hard refresh |
| “Access denied” after OAuth | Allowlist rejected the user (unverified email, wrong domain, etc.) |
| Redirect mismatch | GitHub/IdP callback URL ≠ `WEBCHAT_OIDC_REDIRECT_URI` |
| No GitHub button | `WEBCHAT_AUTH_OIDC_ENABLED` not `true`, or invalid/missing providers JSON |
| Host fails to start | Missing `WEBCHAT_SESSION_SECRET`, missing OIDC redirect URI, or basic auth enabled without password/usernames |
| Everyone still labeled “You” in lobby | Hard refresh after upgrade; confirm messages persist `senderName` / `senderId` (upgrade adapter) |

## Auth HTTP endpoints

Used by the browser UI; you normally do not call these directly.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/auth/config` | Login options (basic enabled, provider list) |
| `GET` | `/api/auth/me` | Current session user |
| `POST` | `/api/auth/login/basic` | Username + password login |
| `GET` | `/api/auth/login?provider=<id>` | Start OIDC/OAuth redirect |
| `GET` | `/api/auth/callback` | OAuth callback (register this URL with the provider) |
| `POST` | `/api/auth/logout` | Clear session cookie |

See [SECURITY.md](../SECURITY.md) for threat-model notes and [api-contract.md](../api-contract.md) for the chat REST/WebSocket API.

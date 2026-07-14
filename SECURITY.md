# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest on npm | yes |

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/Artificer-Innovations/nanoclaw-webchat/security/advisories/new) or by opening a minimal issue asking for a private contact path.

Do not open public issues for undisclosed vulnerabilities.

## Threat model

nanoclaw-webchat supports two authentication modes. Choose the one that matches how you expose the service.

### Local mode (default)

Designed for a **single trusted operator on the same machine** as the NanoClaw host:

- The adapter binds to **`127.0.0.1`** by default (`WEBCHAT_BIND_ADDRESS`)
- Authentication uses a shared **`WEBCHAT_SECRET`** injected into the served HTML
- Anyone who can read the page source or browser storage can act as that user
- Message history is stored locally in the host's SQLite database (`data/webchat.db`)

**Do not expose port `3200` on `0.0.0.0` or the public internet in local mode.** There is no login gate — network reachability equals full access.

WebSocket connections authenticate via a `?token=` query parameter because browser WebSocket APIs cannot set `Authorization` headers. That token may appear in local access logs — scrub or rotate `WEBCHAT_SECRET` if your log pipeline retains query strings.

### Public mode (`WEBCHAT_AUTH_MODE=public`)

For deployments where **multiple users** reach the UI over a network (VPN, tailnet, or internet):

- End users authenticate via **basic login** (shared password + allowed username list) and/or **OIDC/OAuth** (e.g. GitHub)
- Sessions are **signed HTTP-only cookies** (`WEBCHAT_SESSION_SECRET`); the bearer token is **not** injected into HTML
- **Room scoping:** lobby is shared; inbox and DMs are private per authenticated user
- **`WEBCHAT_SECRET`** still exists for MCP/automation bearer access — treat it as a **service/admin credential**, not an end-user password

Public mode is **not** a complete production hardening guide by itself. You are responsible for:

| Control | Why it matters |
|---------|----------------|
| **HTTPS / TLS** | Session cookies and OAuth redirects must not travel in cleartext; set `NODE_ENV=production` for `Secure` cookies |
| **Allowlists** | Without `WEBCHAT_OIDC_ALLOWED_*` or a fixed basic username list, any IdP user who completes OAuth may sign in |
| **Network policy** | `WEBCHAT_BIND_ADDRESS=0.0.0.0` listens on all interfaces — restrict with firewall, VPN, or reverse-proxy ACLs |
| **Secret storage** | Protect `WEBCHAT_SESSION_SECRET`, `WEBCHAT_SECRET`, OAuth client secrets, and `WEBCHAT_BASIC_PASSWORD` |
| **Shared basic password** | All allowed usernames share one password — suitable only for small trusted groups; prefer OIDC for broader access |
| **Session lifetime** | Default 24 hours (`WEBCHAT_SESSION_TTL_SECONDS`); shorten for sensitive deployments |

Setup details: **[docs/public-auth.md](./docs/public-auth.md)**

### Attachment and API access

In both modes, attachment URLs may accept `?token=` for browser fetches that cannot send headers. Prefer session cookies in public mode when the user is logged in.

## MCP server

**Local mode:** the stdio MCP server (`nanoclaw-webchat-mcp`) reads `WEBCHAT_SECRET` from its environment and calls the REST API (typically on localhost). Treat MCP config files like credentials.

**Public mode:** the adapter co-hosts HTTP MCP at `/mcp` with OAuth login. MCP clients receive **per-user bearer tokens** scoped to the logged-in account (same inbox/DM isolation as the browser). Tokens are HMAC-signed JWTs using `WEBCHAT_SESSION_SECRET` and expire after one hour by default.

| Credential | Scope | Use |
|------------|-------|-----|
| MCP OAuth access token | Single authenticated user | Cursor / remote MCP clients in public mode |
| `WEBCHAT_SECRET` | Admin/service (local operator visibility) | stdio MCP, automation, host wiring |

Do not share `WEBCHAT_SECRET` with end users when MCP OAuth is available. Rotate `WEBCHAT_SESSION_SECRET` to invalidate all MCP OAuth tokens and browser sessions.

## What we do not provide

- Rate limiting on login endpoints (add at your reverse proxy if exposed to the internet)
- Account provisioning or password reset flows for basic auth
- Audit logging of sign-in events beyond server logs
- CSRF tokens on auth forms (mitigated when using same-site cookies and HTTPS; evaluate for your deployment)

If you need enterprise-grade identity (SSO groups, MFA enforcement, audit trails), integrate OIDC with your IdP and enforce policy there, plus network-level access controls.

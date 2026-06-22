# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| latest on npm | yes |

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/Artificer-Innovations/nanoclaw-webchat/security/advisories/new) or by opening a minimal issue asking for a private contact path.

Do not open public issues for undisclosed vulnerabilities.

## Threat model

nanoclaw-webchat is designed for **local development use**:

- The web channel adapter binds to **`127.0.0.1` only**
- Authentication uses a shared **`WEBCHAT_SECRET`** injected into the served HTML
- Message history is stored locally in the host's SQLite database

**Do not expose the web chat port on `0.0.0.0` or the public internet** without replacing the authentication model. The default setup assumes a trusted local operator on the same machine as the NanoClaw host.

## MCP server

The bundled MCP server (`nanoclaw-webchat-mcp`) reads `WEBCHAT_SECRET` from its environment and calls the same localhost REST API. Treat MCP config files like credentials.

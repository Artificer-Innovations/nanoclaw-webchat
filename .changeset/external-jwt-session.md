---
"nanoclaw-webchat": minor
---

Add external JWT cookie session auth for silent SSO from a parent app: configure a cookie name + JWKS/iss/aud, verify on `/api/auth/me` and API requests, mint `webchat_session`, and show a host-app sign-in hint when no other providers are enabled.

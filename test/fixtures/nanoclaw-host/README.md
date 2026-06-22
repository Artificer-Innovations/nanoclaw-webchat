# NanoClaw host fixture

Minimal in-repo NanoClaw host skeleton for `scripts/run-integration.mjs`.
CI runs entirely within nanoclaw-webchat — no external host repo checkout.

Regenerate from a local NanoClaw fork when host DB/channel APIs change:

```bash
NANOCLAW_SRC=../nanoclaw-v2 node scripts/prepare-host-fixture.mjs
```

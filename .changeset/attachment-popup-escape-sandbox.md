---
"nanoclaw-webchat": patch
---

Fix: links inside HTML attachment previews now open a real, un-sandboxed tab. Added `allow-popups-to-escape-sandbox` to the HTML attachment iframe sandbox so `target="_blank"` (and right-click → open in new tab) no longer inherits the preview's sandbox — SPA destinations hydrate normally instead of loading with cookies/storage blocked. Same-origin access is still withheld.

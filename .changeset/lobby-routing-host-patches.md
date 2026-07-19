---
"nanoclaw-webchat": patch
---

Install/upgrade now patches the host router and delivery path for lobby stickiness: honor `webchatReceiver` (any channel), treat peer/synthetic/historical copies as context-only, and stamp `senderName`/`senderFolder` on web outbound so UI labels and peer fan-out work. Uninstall reverses only the managed patches.

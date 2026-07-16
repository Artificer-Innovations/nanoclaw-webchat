---
"nanoclaw-webchat": patch
---

Fix `webchat-boot` create_agent live refresh for current NanoClaw guarded delivery APIs (`createAgent`, `validateCreateAgent`, `requestCreateAgentHold`, `reenterGuardedDeliveryAction`) instead of removed `applyCreateAgent` / `handleCreateAgent` exports.

---
"nanoclaw-webchat": minor
---

Add a `postMessage` compose channel for HTML attachment previews. An interactive HTML attachment can now suggest text for the chat composer by posting `{ channel: "nanoclaw-attachment", type: "compose", text }` to its parent. The suggestion only pre-fills the composer draft (appended to any existing text) — it is never auto-sent, and the preview cannot read chat history or reach any other host state. Messages are trusted only when they originate from the specific preview iframe's window (source-identity check, since null-origin sandboxes make `event.origin` meaningless), and compose text is length-capped.

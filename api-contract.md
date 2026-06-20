# NanoClaw Web Chat API Contract (v1)

Local-only HTTP + WebSocket interface between the browser UI and a NanoClaw `web` channel adapter.

**Base URL:** `http://127.0.0.1:<WEBCHAT_PORT>` (default `3200`)

**Auth:** `Authorization: Bearer <WEBCHAT_SECRET>` on REST requests. WebSocket accepts the same header or `?token=<secret>` query parameter.

## REST

### `GET /api/bootstrap`

Returns rooms and agents for the sidebar.

```json
{
  "user": { "id": "web:local", "displayName": "Local" },
  "rooms": [
    { "platformId": "lobby", "name": "Lobby", "kind": "lobby" },
    { "platformId": "dm:sarah", "name": "Sarah", "kind": "dm", "folder": "sarah" }
  ],
  "agents": [
    { "folder": "sarah", "name": "Sarah", "mention": "@sarah" }
  ]
}
```

### `GET /api/rooms/:platformId/threads/:threadId/messages?since=<ms>`

Returns in-memory history for a thread (ring buffer, newest last).

```json
{
  "messages": [
    {
      "id": "web-out-123",
      "direction": "outbound",
      "text": "Hello!",
      "timestamp": 1710000000000,
      "platformId": "lobby",
      "threadId": "thread_abc",
      "senderName": "Sarah",
      "attachments": [
        {
          "name": "screenshot.png",
          "mimeType": "image/png",
          "type": "image",
          "size": 12345,
          "data": "<base64>"
        }
      ]
    }
  ]
}
```

### `POST /api/rooms/:platformId/threads/:threadId/messages`

Body:

```json
{
  "text": "optional caption",
  "attachments": [
    {
      "name": "screenshot.png",
      "mimeType": "image/png",
      "type": "image",
      "data": "<base64>"
    }
  ]
}
```

- `text` is optional when `attachments` is non-empty.
- Max 4 attachments per message; max 5 MB decoded per attachment. The **server must reject** requests that exceed these limits (HTTP 400); the UI also enforces them client-side and surfaces rejections to the user.
- Any file type is accepted; MIME type may be inferred from the filename when omitted.

Response: `{ "messageId": "web-123", "timestamp": 1710000000000 }`

### Attachment payloads in history and WebSocket

Today, `data` (base64) is included on attachments in `GET .../messages` and WS push events so the UI can render without extra round trips. This is acceptable for low-volume personal webchat but does not scale: a full history fetch can return very large JSON when many attachments are buffered in memory.

Planned escape hatch (not required for v1):

- Adapters may expose `GET /api/attachments/:id` (or similar) and populate `url` on history/WS attachments instead of repeating `data`.
- Client sends still use inline `data`; the server stores the blob once and returns `url` on reads.
- Adapters may omit `data` from history/WS responses above a size threshold once `url` is available.

## WebSocket

### `GET /api/ws`

Push events (server → client):

```json
{
  "type": "message",
  "message": {
    "id": "web-out-123",
    "direction": "outbound",
    "text": "Reply text",
    "timestamp": 1710000000000,
    "platformId": "lobby",
    "threadId": "thread_abc",
    "senderName": "Sarah",
    "attachments": [
      {
        "name": "report.pdf",
        "mimeType": "application/pdf",
        "type": "file",
        "size": 54321,
        "data": "<base64>"
      }
    ]
  }
}
```

Optional typing events:

```json
{ "type": "typing", "platformId": "lobby", "threadId": "thread_abc" }
```

## Thread IDs

- Lobby main channel: `main`
- New threads: client-generated `thread_<uuid>`
- DM rooms: same convention

## Platform IDs

| ID | Purpose |
|----|---------|
| `lobby` | Multi-agent @ routing room |
| `dm:<folder>` | 1:1 room with one agent |

Channel type is always `web` on the NanoClaw host side.

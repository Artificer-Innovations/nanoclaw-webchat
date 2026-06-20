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
      "senderName": "Sarah"
    }
  ]
}
```

### `POST /api/rooms/:platformId/threads/:threadId/messages`

Body: `{ "text": "message body" }`

Response: `{ "messageId": "web-123", "timestamp": 1710000000000 }`

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
    "senderName": "Sarah"
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

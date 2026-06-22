# NanoClaw Web Chat API Contract (v1)

Local-only HTTP + WebSocket interface between the browser UI and a NanoClaw `web` channel adapter.

**Base URL:** `http://127.0.0.1:<WEBCHAT_PORT>` (default `3200`)

**Auth:** `Authorization: Bearer <WEBCHAT_SECRET>` on REST requests. WebSocket accepts the same header or `?token=<secret>` query parameter (browser clients only; weaker — may appear in logs).

**Localhost assumption:** The web channel binds to `127.0.0.1` and injects the secret into served `index.html` for the browser UI. Do not expose the server on `0.0.0.0` without replacing this auth model.

## REST

### `GET /api/bootstrap`

Returns rooms (with thread lists), agents, and user identity for the sidebar.

```json
{
  "user": { "id": "web:local", "displayName": "Local" },
  "rooms": [
    {
      "platformId": "lobby",
      "name": "Lobby",
      "kind": "lobby",
      "threads": [{ "id": "main", "title": "Main" }, { "id": "thread_abc", "title": "Topic" }]
    },
    {
      "platformId": "dm:sarah",
      "name": "Sarah",
      "kind": "dm",
      "folder": "sarah",
      "threads": [{ "id": "main", "title": "Main" }]
    }
  ],
  "agents": [
    { "folder": "sarah", "name": "Sarah", "mention": "@sarah" }
  ]
}
```

### `POST /api/rooms/:platformId/threads`

Create a new thread. Body: `{ "title": "Thread 1" }` (title optional, defaults server-side).

Response: `{ "id": "thread_<uuid>", "title": "Thread 1" }`

### `PATCH /api/rooms/:platformId/threads/:threadId`

Rename a thread. Body: `{ "title": "New title" }`

Response: `{ "id": "thread_abc", "title": "New title" }`

### `DELETE /api/rooms/:platformId/threads/:threadId`

Delete a thread and its persisted messages. The `main` thread cannot be deleted (HTTP 400).

Response: `{ "ok": true }`

Also removes matching agent sessions for that thread when containers are not running.

### `GET /api/rooms/:platformId/threads/:threadId/messages?since=<ms>`

Returns persisted history for a thread from `data/webchat.db` (newest last).

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
          "url": "/api/attachments/web-out-123/0-screenshot.png"
        }
      ]
    }
  ],
  "engagedAgents": ["sarah", "diego"]
}
```

- `engagedAgents`: agent **folder** strings for agents previously @'d in this lobby thread. Omitted or `[]` when none. DM rooms may omit or return `[]`.

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

### `GET /api/attachments/:messageId/:filename`

Returns stored attachment bytes for messages persisted in `webchat.db`. Auth required via `Authorization: Bearer` or `?token=<secret>` query parameter (same as WebSocket). The UI appends `?token=` when rendering `<img src>` and download links because those requests cannot send headers.

### Attachment payloads in history and WebSocket

Client sends still use inline `data` (base64). The server stores files once and returns `url` on history and WebSocket reads. WS pushes may still include `data` for immediate outbound display when not yet re-read from storage.

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
        "url": "/api/attachments/web-out-123/0-report.pdf"
      }
    ]
  }
}
```

Optional typing events:

```json
{ "type": "typing", "platformId": "lobby", "threadId": "thread_abc" }
```

Engaged-agent updates (lobby threads — when agents are @'d or removed via UI):

```json
{
  "type": "engaged",
  "platformId": "lobby",
  "threadId": "thread_abc",
  "agents": ["sarah", "diego"]
}
```

### `DELETE /api/rooms/:platformId/threads/:threadId/engaged/:agentFolder`

Lobby only. Removes one agent from the thread engaged set (UI × chip). Response: `{ "agents": ["diego"] }`. Broadcasts the same `engaged` WebSocket event.

## Thread IDs

- Lobby main channel: `main`
- New threads: server-generated `thread_<uuid>` via `POST .../threads`
- DM rooms: same convention

## Platform IDs

| ID | Purpose |
|----|---------|
| `lobby` | Multi-agent @ routing room |
| `dm:<folder>` | 1:1 room with one agent |

Channel type is always `web` on the NanoClaw host side.

## Persistence

Thread metadata and message history are stored in `data/webchat.db` on the host. Survives browser refresh and host restart. Attachment files live under `data/webchat/files/`.

## MCP integration

The [`packages/mcp/`](./packages/mcp/) package provides a stdio MCP server for external clients (Cursor, Claude Desktop, etc.).

| Env var | Default | Purpose |
|---------|---------|---------|
| `WEBCHAT_API_BASE` | `http://127.0.0.1:3200` | REST base URL |
| `WEBCHAT_SECRET` | *(required)* | Bearer token (same as browser UI) |
| `WEBCHAT_REQUEST_TIMEOUT_MS` | `30000` | Per-request fetch timeout in milliseconds |

MCP tools wrap a subset of the REST endpoints above: bootstrap for channel/agent/thread discovery, `POST .../threads` to create threads, and GET/POST `.../messages` for reads and sends. After sending, clients poll read endpoints with `since=<timestamp>` every 2–5 seconds to collect agent replies (same pattern as Slack MCP).

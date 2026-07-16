# NanoClaw Web Chat API Contract (v1)

Local-only HTTP + WebSocket interface between the browser UI and a NanoClaw `web` channel adapter.

**Base URL:** `http://127.0.0.1:<WEBCHAT_PORT>` (default `3200`)

When `WEBCHAT_PUBLIC_PATH` is set (e.g. `/webchat`), a reverse proxy should strip that prefix before the adapter. The adapter still serves `/api` and `/assets` at its root, but rewrites those absolute paths in HTML/JS so browsers request them under the public prefix.

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
      "platformId": "inbox",
      "name": "Inbox",
      "kind": "inbox",
      "threads": [{ "id": "main", "title": "Main" }]
    },
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
      ],
      "card": {
        "type": "ask_question",
        "questionId": "approval-abc",
        "title": "Install MCP server",
        "question": "Agent requests adding @modelcontextprotocol/server-memory",
        "options": [
          { "label": "Approve", "selectedLabel": "✅ Approved", "value": "approve" },
          { "label": "Reject", "selectedLabel": "❌ Rejected", "value": "reject" }
        ],
        "status": "pending"
      }
    }
  ],
  "engagedAgents": ["sarah", "diego"]
}
```

- `engagedAgents`: agent **folder** strings for agents previously @'d in this lobby thread. Omitted or `[]` when none. DM rooms may omit or return `[]`.
- `card`: optional interactive `ask_question` payload on outbound messages (approvals, agent questions). Omitted on plain chat messages.

### `POST /api/rooms/:platformId/threads/:threadId/actions`

Submit a button click on an interactive `ask_question` card.

Body:

```json
{
  "questionId": "approval-abc",
  "value": "approve"
}
```

- `questionId` must match the `card.questionId` on a pending message in that thread.
- Returns HTTP 409 if the card was already answered (idempotent guard).
- Returns HTTP 404 if no matching pending card exists.
- Returns HTTP 403 `{ "error": "not authorized" }` when the card maps to a host `pending_approvals` row and the authenticated user is not allowed to resolve it (wrong named approver, or lacking owner/admin). The card stays pending.

Response: `{ "ok": true }`

Broadcasts a `message_update` WebSocket event with the card marked `status: "answered"`.

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
- Max **10** attachments per message.
- **Browser uploads:** up to **1 GB** per attachment via the upload endpoints below; message POST references staged files with `uploadId` (no inline `data`).
- **Legacy inline base64** (MCP, programmatic callers): max **5 MB** decoded per attachment. The **server must reject** requests that exceed these limits (HTTP 400/413); the UI also enforces them client-side and surfaces rejections to the user.
- Any file type is accepted; MIME type may be inferred from the filename when omitted.

Upload-referenced attachment (browser send):

```json
{
  "name": "report.pdf",
  "mimeType": "application/pdf",
  "type": "file",
  "size": 1234567,
  "uploadId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Response: `{ "messageId": "web-123", "timestamp": 1710000000000, "attachments": [ { "name": "photo.png", "mimeType": "image/png", "type": "image", "size": 1234, "url": "/api/attachments/web-123/0-photo.png" } ] }`

`attachments` is included when the message stored attachment files.

### `POST /api/rooms/:platformId/threads/:threadId/uploads`

`multipart/form-data` with a single `file` field. Streams the file to a staging area (max **1 GB** per file; override via `WEBCHAT_MAX_UPLOAD_BYTES`).

**Browser client:** uses this endpoint for **all** attachment sizes (streaming multipart upload). Completed staging entries remain valid for **30 minutes** (`COMPLETED_UPLOAD_TTL`) while the user composes and sends the message.

Response:

```json
{
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "screenshot.png",
  "mimeType": "image/png",
  "type": "image",
  "size": 12345
}
```

Reference the returned `uploadId` in `POST .../messages` (see upload-referenced attachment above). Both multipart and chunked endpoints enforce the same server-side size limit.

### `POST /api/rooms/:platformId/threads/:threadId/uploads/chunk`

Optional JSON endpoint for **resumable** uploads (512 KB decoded chunks). The web UI does not use this path today; it remains for clients that need retry/resume semantics.

Request body:

```json
{
  "uploadId": "550e8400-e29b-41d4-a716-446655440000",
  "chunkIndex": 0,
  "totalChunks": 4,
  "filename": "report.pdf",
  "mimeType": "application/pdf",
  "data": "<base64 chunk>"
}
```

- Chunk JSON body is capped at ~1 MB (`CHUNK_SIZE * 2`) before decode.
- In-progress chunk assembly times out after **5 minutes** of inactivity (`CHUNK_UPLOAD_TIMEOUT`); the timer refreshes on each accepted chunk.
- Duplicate chunk retries for the same `chunkIndex` are idempotent (no double-count toward size).
- Completed uploads use the same **30 minute** staging TTL as multipart.

Partial response: `{ "ok": true, "received": 1, "total": 4 }`

Final chunk response matches the multipart upload response shape above.

### `GET /api/attachments/:messageId/:filename`

Streams stored attachment bytes for messages persisted in `webchat.db` (constant memory per request; supports **`Range`** requests with `206 Partial Content` / `416` for invalid ranges).

Auth required via `Authorization: Bearer` or `?token=<secret>` query parameter (same as WebSocket):

- **`fetch()` / XHR:** use `Authorization: Bearer` only (no query token).
- **`<img src>` / navigation / download links:** append `?token=` because those requests cannot send headers.

### Attachment payloads in history and WebSocket

Client sends use staged `uploadId` references (browser) or inline `data` (base64, MCP/legacy). The server stores files once and returns `url` on history and WebSocket reads. WS pushes may still include `data` for immediate outbound display when not yet re-read from storage.

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

Soft room-list refresh after agent groups are created (or other wiring syncs). Clients merge rooms/agents without resetting the active conversation:

```json
{
  "type": "bootstrap",
  "bootstrap": { "user": { "id": "web:basic:alice", "displayName": "Alice" }, "rooms": [], "agents": [] },
  "forUserId": "web:basic:alice"
}
```

(`forUserId` is set in public mode so only that client's tab applies the payload.)

Interactive card updates (after a button click on an `ask_question` card):

```json
{
  "type": "message_update",
  "message": {
    "id": "web-out-123",
    "direction": "outbound",
    "text": "Install MCP server\nAgent requests adding @modelcontextprotocol/server-memory",
    "timestamp": 1710000000000,
    "platformId": "inbox",
    "threadId": "main",
    "card": {
      "type": "ask_question",
      "questionId": "approval-abc",
      "title": "Install MCP server",
      "question": "Agent requests adding @modelcontextprotocol/server-memory",
      "options": [
        { "label": "Approve", "selectedLabel": "✅ Approved", "value": "approve" },
        { "label": "Reject", "selectedLabel": "❌ Rejected", "value": "reject" }
      ],
      "status": "answered",
      "selectedValue": "approve",
      "selectedLabel": "✅ Approved"
    }
  }
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
| `inbox` | Host-initiated notifications and interactive approval cards (MCP install, restarts, permissions) |
| `lobby` | Multi-agent @ routing room |
| `dm:<folder>` | 1:1 room with one agent |

Channel type is always `web` on the NanoClaw host side.

## Persistence

Thread metadata and message history are stored in `data/webchat.db` on the host. Survives browser refresh and host restart. Attachment files live under `data/webchat/files/`.

## MCP integration

The MCP server lives in [`packages/mcp/`](./packages/mcp/) and ships in the **`nanoclaw-webchat`** npm package as the `nanoclaw-webchat-mcp` bin.

### Local mode (stdio)

| Env var | Default | Purpose |
|---------|---------|---------|
| `WEBCHAT_API_BASE` | `http://127.0.0.1:3200` | REST base URL |
| `WEBCHAT_SECRET` | *(required)* | Bearer token (same as browser UI) |
| `WEBCHAT_REQUEST_TIMEOUT_MS` | `30000` | Per-request fetch timeout in milliseconds |

### Public mode (HTTP + OAuth)

When `WEBCHAT_AUTH_MODE=public`, the adapter co-hosts Streamable HTTP MCP at `/mcp` with OAuth 2.1 login. MCP clients receive per-user bearer tokens after browser login.

| Env var | Default | Purpose |
|---------|---------|---------|
| `WEBCHAT_MCP_HTTP_ENABLED` | `true` in public mode | Enable `/mcp` HTTP transport |
| `WEBCHAT_PUBLIC_BASE_URL` | derived from OIDC redirect URI | Canonical public origin for OAuth resource indicator |

OAuth endpoints: `GET /authorize`, `POST /token`, `POST /register`, `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource/mcp`.

MCP bearer tokens are accepted on REST routes with the same per-user room scoping as browser sessions. `WEBCHAT_SECRET` remains an admin/service credential.

MCP tools wrap a subset of the REST endpoints above: bootstrap for channel/agent/thread discovery, `POST .../threads` to create threads, and GET/POST `.../messages` for reads and sends. After sending, clients poll read endpoints with `since=<timestamp>` every 2–5 seconds to collect agent replies (same pattern as Slack MCP).

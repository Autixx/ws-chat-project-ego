# ProjectEGO Request/Response Chat Workbench

Browser request/response workbench for ProjectEGO planning automation. The UI separates user requests, agent/system responses, linked attachments, and draft decisions instead of rendering a single ChatGPT-like vertical timeline.

## Architecture

- Express HTTP server with `GET /health`.
- WebSocket endpoint at `GET /ws`.
- Authelia header auth with local development bypass.
- SQLite-backed chat history:
  - conversations
  - messages
  - draft references
  - attachment metadata
  - app migrations
- Filesystem-backed artifacts:
  - full draft JSON
  - preview text
  - per-item JSON
  - future uploaded attachments
- LLM provider abstraction with `MockProvider` and `CodexProvider` placeholder.
- Optional Plane and n8n integration stubs.
- Strict component health checks for SQLite, Plane configuration, and n8n configuration.
- Multipart upload API for `.txt`, `.md`, `.mp3`, and `.mp4` attachments.

## UI Layout

The primary screen is a compact technical workbench:

- top status bar with WS, Plane, n8n, DB and user indicators
- request search field
- response search field
- left request panel with answer status squares
- right response panel with decision status squares
- attachments panel linked to the selected request
- request input field with mode selector, file attach and Ctrl+Enter send
- draft inspector opened explicitly from a draft response

Request answer status:

- red square: `no_response`
- green square: `has_response`

Response decision status:

- white square: `pending`
- green square: `applied`
- red square: `dropped`
- gray square: `kept`

Expanded pending responses expose response-level `Apply`, `Drop`, and `Keep` buttons. These persist decision status in SQLite metadata. Item-level draft Apply/Keep/Drop remains in the Draft Inspector.

## Storage

SQLite path is controlled by:

```env
SQLITE_PATH=./data/projectego-chat.sqlite
```

If `SQLITE_PATH` is not set, the app uses:

```text
path.join(DATA_DIR, "projectego-chat.sqlite")
```

Draft artifacts still use:

```env
DATA_DIR=./data
```

Typical production layout:

```text
/app/data/projectego-chat.sqlite
/app/data/drafts/
/app/data/attachments/
/app/data/unclarified/
```

Attachment storage layout:

```text
DATA_DIR/
└── attachments/
    ├── staging/
    │   └── USER_ID/
    │       └── UPLOAD_ID/
    │           └── sanitized-file-name.ext
    └── CONVERSATION_ID/
        └── REQUEST_MESSAGE_ID/
            └── ATTACHMENT_ID_original-name.ext
```

SQLite stores lightweight chat data only. Draft response metadata stores references such as:

```json
{
  "kind": "draft",
  "jobId": "20260618-010203-abcdef",
  "itemsCount": 3,
  "mode": "tasks",
  "responseToRequestId": "M-...",
  "decisionStatus": "pending"
}
```

Full `draft.json`, `preview.txt`, and per-item JSON files are loaded from the filesystem by `draft_open`.

## Request / Response Linking

User submissions are stored as `request` messages. Assistant, tool, status, draft, apply, unclarified, and error messages are response-side messages linked through metadata:

```json
{
  "responseToRequestId": "M-request-id"
}
```

Selecting a request highlights linked responses. Selecting a response highlights the linked request.

## Draft Open Flow

Draft generation saves artifact files and inserts a lightweight row in `draft_refs`. The response panel shows a draft row with `Open in Draft Inspector`.

Client request:

```json
{
  "type": "draft_open",
  "conversationId": "C-...",
  "jobId": "20260618-010203-abcdef"
}
```

The backend validates that the conversation belongs to the current user and that `jobId` is referenced by `draft_refs`, then loads:

- `DATA_DIR/drafts/JOB_ID/draft.json`
- `DATA_DIR/drafts/JOB_ID/preview.txt`

It then emits `draft_saved` and `draft_result` for the inspector.

## Attachments

Supported UI/file metadata types:

- `.txt`
- `.md`
- `.mp3`
- `.mp4`

Maximum size: 25 MB.

For this pass, `.txt` and `.md` are still read into the request text in the browser. Attachment metadata is persisted in SQLite; binary upload/storage is prepared structurally but not implemented yet. Attachment binary data must not be stored in SQLite.

## Install

```bash
npm install
```

## Local Development

```bash
cp .env.example .env
npm run dev
```

Open:

```text
http://127.0.0.1:19100
```

Useful local env:

```env
HOST=127.0.0.1
PORT=19100
DATA_DIR=./data
SQLITE_PATH=./data/projectego-chat.sqlite
DEV_AUTH_BYPASS=true
TRUST_AUTHELIA_HEADERS=false
LLM_PROVIDER=mock
```

## Production Without Docker

```bash
npm ci
npm run build
NODE_ENV=production \
HOST=127.0.0.1 \
PORT=19100 \
DATA_DIR=/var/lib/projectego-ws-chat \
SQLITE_PATH=/var/lib/projectego-ws-chat/projectego-chat.sqlite \
DEV_AUTH_BYPASS=false \
TRUST_AUTHELIA_HEADERS=true \
npm start
```

## Docker

Build:

```bash
docker build -t projectego-ws-chat:local .
```

Run:

```bash
docker run --rm \
  -p 19100:19100 \
  -e HOST=0.0.0.0 \
  -e PORT=19100 \
  -e DATA_DIR=/app/data \
  -e SQLITE_PATH=/app/data/projectego-chat.sqlite \
  -e DEV_AUTH_BYPASS=true \
  -e TRUST_AUTHELIA_HEADERS=false \
  -v projectego-ws-chat-data:/app/data \
  projectego-ws-chat:local
```

Compose:

```bash
docker compose up --build
```

Only one HTTP/WebSocket port is exposed. Runtime state should live in the mounted `/app/data` volume.

## Health Check

```bash
curl http://127.0.0.1:19100/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "projectego-ws-chat",
  "components": {
    "db": {
      "status": "ok",
      "quickCheck": "ok",
      "writable": true
    },
    "plane": {
      "status": "configured"
    },
    "n8n": {
      "status": "unconfigured"
    }
  }
}
```

The SQLite healthcheck verifies `SELECT 1`, `PRAGMA quick_check`, and write access to the database directory. Production responses avoid exposing full host paths.

## Caddy + Authelia

The app does not implement login. In production, put it behind Caddy and Authelia. With `TRUST_AUTHELIA_HEADERS=true`, the server reads:

- `Remote-User`
- `Remote-Groups`
- `Remote-Email`
- `Remote-Name`

Example:

```caddyfile
chat.project-ego.online {
    encode gzip zstd

    import auth_project_ego

    reverse_proxy 127.0.0.1:19100 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

## MockProvider Test

1. Start with `LLM_PROVIDER=mock`.
2. Open the UI.
3. Create or open a conversation.
4. Send a `Chat` request.
5. Confirm the request appears in the left panel and the response appears in the right panel.
6. Reload and confirm both persist.
7. Send `Digest`, `Tasks`, or `Abstract idea`.
8. Click the draft response.
9. Click `Open in Draft Inspector`.
10. Choose Apply/Keep/Drop per item.
11. Click `Apply selected`.
12. Change response-level Apply/Drop/Keep status and reload to verify persistence.

If Plane is not configured, the app returns `Plane integration is not configured.` and stores kept items in unclarified storage.

## Upload API

Attachments are uploaded through HTTP multipart, not WebSocket binary frames.

```text
POST /api/uploads
```

Form field:

```text
files
```

Supported extensions:

- `.txt`
- `.md`
- `.mp3`
- `.mp4`

Limit: 25 MB per file.

Response:

```json
{
  "uploads": [
    {
      "uploadId": "UP-...",
      "fileName": "note.md",
      "mimeType": "text/markdown",
      "sizeBytes": 1024,
      "storagePath": "attachments/staging/local-dev/UP-.../note.md"
    }
  ]
}
```

The frontend sends returned `uploadId`s in `message_send.attachmentUploadIds`. The backend moves staged files into final request attachment storage and inserts SQLite metadata.

Attachment download/open:

```text
GET /api/attachments/:attachmentId
```

This endpoint authenticates the user, verifies the attachment belongs to a conversation owned by that user, and streams the file with safe content headers. `.mp3` and `.mp4` are rendered with browser audio/video controls in the workbench.

## Plane Workspace Authorization

Authelia remains the authentication layer. Plane can optionally be used as an authorization source.

```env
AUTHZ_PROVIDER=none
```

Options:

- `none`: current behavior; authenticated Authelia users can access the app.
- `plane_workspace`: after Authelia authentication, the app checks Plane workspace membership through the Plane API.

Required for Plane authorization:

```env
AUTHZ_PROVIDER=plane_workspace
PLANE_BASE_URL=
PLANE_WORKSPACE=projectego
PLANE_API_KEY=
```

The membership check matches by email first, then username. If Plane is unavailable or not configured while `AUTHZ_PROVIDER=plane_workspace`, access is denied. This is workspace authorization only; it is not Plane session-cookie login and does not read Plane internals.

## Backup

Back up both SQLite and artifact files.

Recommended simple backup:

1. Stop the service, or use SQLite online backup tooling.
2. Copy `projectego-chat.sqlite` and its WAL/SHM files if present.
3. Copy `drafts/`, `attachments/`, and `unclarified/`.

For Docker, back up the mounted `/app/data` volume.

## Environment

| Variable | Purpose |
| --- | --- |
| `HOST` | Bind host. Use `127.0.0.1` behind Caddy, `0.0.0.0` in Docker. |
| `PORT` | Single HTTP/WebSocket port. |
| `DATA_DIR` | Draft artifacts, attachments, and unclarified files. |
| `SQLITE_PATH` | SQLite database file for chat history. |
| `DEV_AUTH_BYPASS` | Local fake auth. Keep false in production. |
| `TRUST_AUTHELIA_HEADERS` | Trust Authelia `Remote-*` headers. |
| `AUTHZ_PROVIDER` | `none` or `plane_workspace`. |
| `LLM_PROVIDER` | `mock` or `codex`. |
| `CODEX_AGENT_URL` | Optional HTTP endpoint for Codex provider. |
| `CODEX_AGENT_TOKEN` | Optional bearer token for Codex provider. |
| `CODEX_FALLBACK_TO_MOCK` | Fall back to mock if Codex is not configured. |
| `PLANE_BASE_URL` | Optional Plane API base URL. |
| `PLANE_WORKSPACE` | Plane workspace slug. |
| `PLANE_API_KEY` | Optional Plane API key. |
| `N8N_BASE_URL` | Optional n8n base URL. |
| `N8N_WEBHOOK_TOKEN` | Optional n8n webhook token. |

## Current Limitations

- Plane work-item creation is still guarded until project ID mapping is implemented.
- Plane workspace authorization uses the documented/expected workspace members API endpoint and requires a Plane API key.
- `CodexProvider` is non-streaming unless the configured backend streams or returns incremental events.
- SQLite is intended for single-node deployment.
- No database-backed full-text search yet.
- Binary attachment upload/storage is not implemented yet; only metadata and text-file request input are active.
- No Telegram integration.
- No custom login; Authelia remains the authentication layer.

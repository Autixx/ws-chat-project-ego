# ProjectEGO Dashboard

Browser dashboard for ProjectEGO planning automation. The UI separates user requests, agent/system responses, linked attachments, draft decisions, execution jobs, and component reachability instead of rendering a single ChatGPT-like vertical timeline.

## Architecture

- Express HTTP server with `GET /health`.
- WebSocket endpoint at `GET /ws`.
- Local SQLite-backed authentication with registration, login, logout, and session cookies.
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
  - uploaded attachment files
- LLM provider abstraction with `MockProvider` and `CodexProvider` placeholder.
- Background component reachability polling for SQLite, LLM-agent/codex-agent, n8n, and Plane.
- n8n is the controlled workflow executor and future writer to Plane.
- Plane is informational reachability only from the Dashboard; Dashboard does not create Plane work-items directly.
- Multipart upload API for `.txt`, `.md`, `.mp3`, `.mp4`, `.jpg`, `.png`, and `.svg` attachments.
- Local SQLite-backed registration, login, logout, and persistent sessions.

## UI Layout

The primary screen is a compact technical dashboard:

- top status bar with WS, DB, LLM-agent, n8n, Plane and user indicators
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

Execution status is tracked separately from decision status. Clicking response-level `Apply` records the user decision and creates a backend execution job, but the job remains `not_started` until a workflow callback updates it. A green decision square therefore means "user chose Apply", not "n8n/Plane work succeeded".

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

Supported upload types:

- `.txt`
- `.md`
- `.mp3`
- `.mp4`
- `.jpg`
- `.png`
- `.svg`

Maximum size: 25 MB.

Attachments are uploaded through `POST /api/uploads`, finalized when the request is sent, linked to the request message in SQLite, and stored as files under `DATA_DIR/attachments`. Text files remain attachments and can be previewed in a read-only subwindow. `.mp3` renders with browser audio controls. `.mp4` opens in a movable video preview subwindow. `.jpg`, `.png`, and `.svg` render as image previews. Attachment binary data is never stored in SQLite.

## Job Execution Tracking

Response-level decision status and backend execution status are separate:

- decision: `pending`, `applied`, `dropped`, `kept`
- execution: `not_started`, `queued`, `running`, `succeeded`, `failed`, `partial`, `cancelled`

When a response is marked `Apply`, the backend creates a row in `jobs` linked to the conversation, request message, response message, and draft job id when available. Because real Plane/n8n execution is not wired yet, the initial execution status is `not_started` with `backendConfigured: false`.

Machine workflow callbacks can update jobs through:

```http
POST /api/jobs/:jobId/events
Authorization: Bearer <JOB_CALLBACK_TOKEN>
Content-Type: application/json
```

Example:

```bash
curl -X POST http://127.0.0.1:19100/api/jobs/JOB-.../events \
  -H "Authorization: Bearer $JOB_CALLBACK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"running","eventType":"started","message":"workflow started"}'
```

The callback appends a `job_events` row, updates `jobs.status`, sets `started_at` / `finished_at` where applicable, and stores `error_message` for failed jobs. Browser session cookies are not required for this machine-to-machine endpoint.

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
AUTH_MODE=local
SESSION_SECRET=dev-session-secret
REGISTRATION_ENABLED=true
REGISTRATION_INVITE_CODE=dev-invite
COOKIE_SECURE=false
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
AUTH_MODE=local \
SESSION_SECRET=<long-random-secret> \
REGISTRATION_ENABLED=true \
REGISTRATION_INVITE_CODE=<invite-code> \
COOKIE_SECURE=true \
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
  -e AUTH_MODE=local \
  -e SESSION_SECRET=dev-session-secret \
  -e REGISTRATION_ENABLED=true \
  -e REGISTRATION_INVITE_CODE=dev-invite \
  -e COOKIE_SECURE=false \
  -v projectego-chat-data:/app/data \
  projectego-ws-chat:local
```

Compose:

```bash
docker compose up --build
```

The included `docker-compose.yml` is shaped for TrueNAS-compatible deployment and runs the container as:

```yaml
user: "568:568"
```

Only one HTTP/WebSocket port is exposed. Runtime state should live in the mounted `/app/data` volume.

## TrueNAS Apps / GHCR Updates

For TrueNAS Apps, use the published registry image instead of local `build: .`.

GitHub Actions publishes this image to GitHub Container Registry:

```text
ghcr.io/autixx/ws-chat-project-ego:latest
```

If the GHCR package is private, either make it public in GitHub Packages or configure TrueNAS registry credentials with a GitHub token that can read packages.

Every push to `main` publishes:

- `latest`
- `sha-<commit>`

Every Git tag like `v0.1.1` also publishes:

- `v0.1.1`

Example registry compose file:

```bash
docker compose -f docker-compose.registry.yml up -d
```

TrueNAS custom app settings should use:

```text
Image: ghcr.io/autixx/ws-chat-project-ego:latest
Pull policy: always
Run as user/group: 568:568
Container port: 19100
Host port: 19100
Volume mount: /app/data
```

To update from the TrueNAS Apps UI:

1. Push changes to GitHub and wait for the `Docker image` Action to finish.
2. Open the app in TrueNAS.
3. Use redeploy/update so TrueNAS pulls the current image.
4. Hard refresh the browser after the container is recreated.

For predictable production rollouts, prefer a fixed tag such as:

```text
ghcr.io/autixx/ws-chat-project-ego:v0.1.1
```

Then update the tag in TrueNAS when moving to a newer release.

## Health Check

```bash
curl http://127.0.0.1:19100/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "projectego-dashboard",
  "components": {
    "db": {
      "status": "ok",
      "quickCheck": "ok",
      "writable": true
    },
    "llmAgent": {
      "status": "reachable"
    },
    "n8n": {
      "status": "configured"
    },
    "plane": {
      "status": "reachable"
    },
    "jobs": {
      "callbackConfigured": true
    }
  }
}
```

The SQLite healthcheck verifies `SELECT 1`, `PRAGMA quick_check`, and write access to the database directory. Production responses avoid exposing full host paths. Dashboard global health returns `error` only when DB health fails; LLM-agent, n8n, and Plane failures are exposed as component statuses.

Component status polling runs in the background. `LLM_PROVIDER=codex` requires `CODEX_AGENT_URL` for generation; `CODEX_AGENT_HEALTH_URL` can override the probe URL. n8n must have `N8N_BASE_URL` and `N8N_WEBHOOK_TOKEN` to be considered configured. Plane reachability is informational only.

## Caddy + Authelia

The app implements its own local authentication. It can run behind Caddy and Authelia, but it does not depend on Authelia headers in `AUTH_MODE=local`.

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

## Local Authentication

The supported auth mode is:

```env
AUTH_MODE=local
```

Local auth uses SQLite tables for `users` and `sessions`.

- Passwords are hashed with Argon2id.
- Raw session tokens are never stored in SQLite; only HMAC hashes are stored.
- Sessions expire after 30 days.
- Cookie name: `projectego_session`.
- Cookie flags: `httpOnly`, `sameSite=lax`, `secure=COOKIE_SECURE`, `path=/`.

Production requires:

```env
SESSION_SECRET=<long-random-secret>
```

Registration is invite-code protected:

```env
REGISTRATION_ENABLED=true
REGISTRATION_INVITE_CODE=<admin-defined-invite-code>
```

Auth routes:

```text
GET  /login
GET  /register
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
```

Plane is no longer used for chat authentication or authorization. Plane variables are used only for informational reachability from the Dashboard. n8n is the workflow executor and the intended writer to Plane.

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

Dashboard does not create Plane work-items directly. Apply workflow execution is tracked as jobs and should be handled by n8n callbacks.

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
- `.jpg`
- `.png`
- `.svg`

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

This endpoint authenticates the user, verifies the attachment belongs to a conversation owned by that user, and streams the file with safe content headers. `.mp3` and `.mp4` are rendered with browser audio/video controls in the workbench. `.jpg` and `.png` are rendered as image previews.

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
| `AUTH_MODE` | `local`. |
| `SESSION_SECRET` | Required in production for session hashing. |
| `REGISTRATION_ENABLED` | Enables or disables new local registrations. |
| `REGISTRATION_INVITE_CODE` | Required invite code when registration is enabled. |
| `COOKIE_SECURE` | Sets the secure flag on session cookies. |
| `DEV_AUTH_BYPASS` | Legacy env retained but not used for local auth access control. |
| `TRUST_AUTHELIA_HEADERS` | Legacy env retained but not used for local auth access control. |
| `LLM_PROVIDER` | `mock` or `codex`. |
| `CODEX_AGENT_URL` | Optional HTTP endpoint for Codex provider. |
| `CODEX_AGENT_HEALTH_URL` | Optional health URL for LLM-agent reachability polling. |
| `CODEX_AGENT_TOKEN` | Optional bearer token for Codex provider. |
| `CODEX_FALLBACK_TO_MOCK` | Fall back to mock if Codex is not configured. |
| `PLANE_BASE_URL` | Optional Plane base URL for informational reachability. |
| `PLANE_HEALTH_URL` | Optional Plane health URL for reachability polling. |
| `PLANE_WORKSPACE` | Plane workspace slug. |
| `PLANE_API_KEY` | Optional Plane API key retained for future integration; Dashboard is not a Plane writer. |
| `N8N_BASE_URL` | Optional n8n base URL. |
| `N8N_HEALTH_URL` | Optional n8n health URL for reachability polling. |
| `N8N_WEBHOOK_TOKEN` | Optional n8n webhook token. |
| `JOB_CALLBACK_TOKEN` | Optional bearer token for `POST /api/jobs/:jobId/events`. Required before workflow callbacks are accepted. |
| `COMPONENT_STATUS_INTERVAL_MS` | Component reachability polling interval. Default `15000`. |
| `COMPONENT_STATUS_TIMEOUT_MS` | Per-probe timeout. Default `2000`. |

## Current Limitations

- Plane work-item creation is out of scope for Dashboard; route execution through n8n.
- `CodexProvider` is non-streaming unless the configured backend streams or returns incremental events.
- SQLite is intended for single-node deployment.
- No database-backed full-text search yet.
- Password reset, email verification, and login rate limiting are not implemented yet.
- No Telegram integration.
- Roles exist in the schema, but there is no admin UI or advanced permission system yet.

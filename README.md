# ProjectEGO Dashboard

Browser dashboard for ProjectEGO planning automation. The UI separates user requests, agent/system responses, linked attachments, draft decisions, execution jobs, and component reachability instead of rendering a single ChatGPT-like vertical timeline.

## Architecture

- Express HTTP server with `GET /health`.
- WebSocket endpoint at `GET /ws`.
- Shared PostgreSQL-backed authentication through ProjectEGO Admin, with local SQLite auth available for isolated development.
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
- Multipart upload API for text-like files, media attachments, and image previews.
- Dashboard and PM both use their own ProjectEGO login screens; Authelia is optional outer perimeter protection only.

## ProjectEGO PM Boundary

ProjectEGO PM is designed as a separate service next to the Dashboard, not as a privileged Dashboard screen. The intended deployment is:

- `dashboard.project-ego.online`: closed administrative Dashboard with Codex-agent/n8n execution.
- `pm.project-ego.online`: team project-management surface.

PM runs from the same repository and image, but with a separate entrypoint:

```bash
node dist/pm/server.js
```

PM exposes:

- `GET /health`
- `POST /api/pm/auth/login`
- `POST /api/pm/auth/logout`
- `GET /api/pm/me`
- `GET /api/pm/notifications`
- `POST /api/pm/notifications/:notificationId/read`
- `POST /api/pm/notifications/read-all`
- `GET /api/pm/webhook-deliveries`
- `POST /api/pm/webhook-deliveries/:deliveryId/retry`
- `GET /api/pm/bootstrap/status`
- `POST /api/pm/bootstrap`
- `GET /api/pm/operator/status`
- `GET /api/pm/security-boundary`
- `GET /api/pm/architecture`
- `GET /api/pm/projects`
- `POST /api/pm/projects`
- `PATCH /api/pm/projects/:projectId`
- `POST /api/pm/projects/:projectId/archive`
- `DELETE /api/pm/projects/:projectId`
- `DELETE /api/pm/projects/:projectId/permanent`
- `GET /api/pm/projects/:projectId/members`
- `POST /api/pm/projects/:projectId/members`
- `PUT /api/pm/projects/:projectId/members/:userId`
- `DELETE /api/pm/projects/:projectId/members/:userId`
- `GET /api/pm/projects/:projectId/labels`
- `POST /api/pm/projects/:projectId/labels`
- `PATCH /api/pm/projects/:projectId/labels/:labelId`
- `DELETE /api/pm/projects/:projectId/labels/:labelId`
- `GET /api/pm/projects/:projectId/filters`
- `POST /api/pm/projects/:projectId/filters`
- `PATCH /api/pm/projects/:projectId/filters/:filterId`
- `DELETE /api/pm/projects/:projectId/filters/:filterId`
- `GET /api/pm/projects/:projectId/epics`
- `POST /api/pm/projects/:projectId/epics`
- `GET /api/pm/projects/:projectId/sprints`
- `POST /api/pm/projects/:projectId/sprints`
- `PATCH /api/pm/sprints/:sprintId`
- `GET /api/pm/projects/:projectId/boards`
- `POST /api/pm/projects/:projectId/boards/kanban/default`
- `POST /api/pm/projects/:projectId/boards/kanban`
- `GET /api/pm/boards/:boardId`
- `POST /api/pm/boards/:boardId/columns`
- `POST /api/pm/boards/:boardId/tasks`
- `POST /api/pm/projects/:projectId/boards/default/tasks`
- `DELETE /api/pm/boards/:boardId/permanent`
- `GET /api/pm/projects/:projectId/tasks`
- `POST /api/pm/projects/:projectId/tasks`
- `PATCH /api/pm/tasks/:taskId`
- `POST /api/pm/tasks/:taskId/archive`
- `DELETE /api/pm/tasks/:taskId`
- `DELETE /api/pm/tasks/:taskId/permanent`
- `POST /api/pm/tasks/:taskId/move`
- `GET /api/pm/tasks/:taskId/dependencies`
- `POST /api/pm/tasks/:taskId/dependencies`
- `DELETE /api/pm/tasks/:taskId/dependencies/:blockingTaskId`
- `POST /api/pm/tasks/:taskId/sprint`
- `POST /api/pm/tasks/:taskId/assignee`
- `GET /api/pm/tasks/:taskId/labels`
- `POST /api/pm/tasks/:taskId/labels`
- `DELETE /api/pm/tasks/:taskId/labels/:labelId`
- `GET /api/pm/tasks/:taskId/comments`
- `POST /api/pm/tasks/:taskId/comments`
- `PATCH /api/pm/comments/:commentId`
- `DELETE /api/pm/comments/:commentId`
- `GET /api/pm/tasks/:taskId/attachments`
- `POST /api/pm/tasks/:taskId/attachments`
- `GET /api/pm/attachments/:attachmentId`
- `DELETE /api/pm/attachments/:attachmentId`
- `GET /api/pm/tasks/:taskId/activity`
- `GET /pm/ws`

PM also serves its browser shell from the PM service root:

```text
https://pm.project-ego.online/
```

PM must not receive Dashboard/agent secrets. Keep these variables out of the `projectego-pm` service:

- `CODEX_AGENT_TOKEN`
- `AGENT_ATTACHMENT_TOKEN`
- `JOB_CALLBACK_TOKEN`
- `N8N_WEBHOOK_TOKEN`
- `PLANE_API_KEY`
- `DASHBOARD_INTERNAL_BASE_URL`

The PM runtime validates this boundary on startup. If any of those variables are present, the PM service refuses to start.

ProjectEGO uses PostgreSQL `core.users` as the shared identity and privilege source for Admin, Dashboard shared-auth mode, and PM. PM still uses `PM_DATABASE_URL` for its project-management data, but the same database also owns shared users, sessions, and access flags. The schema contract is in:

```text
src/pm/postgres-schema.sql
```

The PM container applies this schema automatically on startup when `PM_DATABASE_URL` is configured. This is enabled by default through:

```env
PM_AUTO_MIGRATE=true
```

Set `PM_AUTO_MIGRATE=false` only if you want to run schema changes manually. For manual local runs:

```bash
npm run build
PM_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego npm run pm:migrate
```

For a one-off manual Docker Compose migration:

```bash
docker compose run --rm projectego-pm node dist/pm/migrate.js
```

For a registry image without Compose:

```bash
docker run --rm \
  -e PM_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego \
  ghcr.io/autixx/ws-chat-project-ego:v0.2.26 \
  node dist/pm/migrate.js
```

Bootstrap the first PM project owner from a running container with the one-time API:

```bash
curl -X POST https://pm.project-ego.online/api/pm/bootstrap \
  -H "Authorization: Bearer <PM_BOOTSTRAP_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

`GET /api/pm/bootstrap/status` reports whether PM already has a project owner and whether `PM_BOOTSTRAP_TOKEN` is configured. `POST /api/pm/bootstrap` works only before the first project owner exists. It uses the authenticated PM identity as the first owner; if `PM_BOOTSTRAP_USERNAME` is set, the authenticated username must match it. The endpoint creates the bootstrap project from `PM_BOOTSTRAP_PROJECT_KEY` / `PM_BOOTSTRAP_PROJECT_NAME` and then refuses further bootstrap writes.

The older one-shot CLI remains available for manual administration:

```bash
docker compose run --rm \
  -e PM_BOOTSTRAP_USERNAME=tris \
  -e PM_BOOTSTRAP_EMAIL=tris@example.com \
  -e PM_BOOTSTRAP_DISPLAY_NAME="Tris" \
  -e PM_BOOTSTRAP_PROJECT_KEY=PROJECTEGO \
  -e PM_BOOTSTRAP_PROJECT_NAME="ProjectEGO" \
  projectego-pm \
  node dist/pm/bootstrap.js
```

The bootstrap username must match a ProjectEGO Admin user that can sign in to PM with `pm_access=true`.

Optional PostgreSQL integration tests can validate the PM store against a real test database:

```bash
PM_TEST_DATABASE_URL=postgres://projectego_admin:...@127.0.0.1:5432/projectego npm run test:pm:postgres
```

The default `npm test` suite skips the PostgreSQL integration test unless `PM_TEST_DATABASE_URL` is set. The integration test applies PM migrations and creates unique test users/projects.

PM attachment storage is filesystem-backed and separate from PostgreSQL binary data:

```env
PM_ATTACHMENTS_DIR=/app/pm-data/attachments
PM_MAX_ATTACHMENT_BYTES=26214400
```

Uploaded PM task files are stored under `PM_ATTACHMENTS_DIR` with internal safe filenames. PostgreSQL stores metadata only: original display filename, internal stored filename, MIME type, size, and storage path.

The schema separates logical areas:

- `core`
- `pm`
- `agent`
- `automation`
- `audit`

Dashboard can use the shared users by running with `AUTH_MODE=core` and `CORE_DATABASE_URL`. PM does not receive direct access to Dashboard chat history, prompts, agent sessions, Codex APIs, or automation secrets.

PM authentication and authorization are enforced server-side through ProjectEGO's own login and `core.users`. The PM backend requires `pm_access=true` or a global admin role before returning or mutating project data. The first project API layer supports these project roles:

- `admin`
- `project_owner`
- `member`
- `viewer`

Project/task mutations use optimistic `version` fields. Clients can send `expectedVersion`; stale writes return conflict responses instead of silently overwriting another user's change. Task moves store numeric position values so cards can be inserted between existing cards without full-board renumbering.

The first PM frontend shell supports:

- project list and creation
- project archive/unarchive
- epic list and creation
- compact PM side rails with project drawer, task/media drawer controls, and hidden ops panels
- task list and creation
- project-level and epic-level default Kanban boards
- multiple named Kanban boards per project
- Kanban columns with drag-and-drop task movement
- task drawer editing
- task drawer comments with own-comment edit/delete
- task drawer file attachments with download/delete
- task drawer activity history from `audit.events`
- backlog and sprint planning with sprint lifecycle controls
- task assignment to backlog or a selected sprint
- task dependency management with blocked-by and blocks lists
- in-app notifications for task comments, assignee/creator updates, and `@username` mentions
- project team management with role changes and member removal
- task assignee picker backed by project membership
- project labels with edit/delete and task label assignment/removal
- label filtering and user-scoped saved task filters with update/delete
- saved filters automatically drop deleted label references
- status, priority, label, and due-date filters
- database-backed task search across ID, title, and description
- task due dates with overdue highlighting
- task archive/delete actions
- PM WebSocket reconnect and refresh on structured events
- outgoing PM webhooks for task/comment/attachment/project events with `X-ProjectEGO-Signature`
- SMTP-backed project invites through `POST /api/pm/projects/:projectId/invites`
- token-protected PM automation API for n8n at `/api/pm/automation/*`

## ProjectEGO Admin

Admin is the third service for shared user and privilege management. It should run on its own internal port and usually behind its own subdomain:

```text
https://admin.project-ego.online/
```

Admin uses the same PostgreSQL database as PM and stores users in `core.users`. It is the intended place to create users, reset passwords, disable users, and control access flags:

- `dashboard_access`: user may sign in to Dashboard when Dashboard uses `AUTH_MODE=core`.
- `pm_access`: user may enter PM after PM resolves the incoming identity.
- `global_role`: `super_admin`, `admin`, or `user`.

The first superuser is created automatically from environment variables on Admin startup:

```env
ADMIN_BOOTSTRAP_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=<long-random-password>
ADMIN_BOOTSTRAP_EMAIL=admin@example.local
ADMIN_BOOTSTRAP_DISPLAY_NAME=ProjectEGO Admin
```

Admin runtime:

```bash
npm run build
ADMIN_HOST=127.0.0.1 \
ADMIN_PORT=19120 \
ADMIN_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego \
ADMIN_SESSION_SECRET=<long-random-secret> \
npm run start:admin
```

Dashboard can use the same users by switching from local SQLite auth to shared core auth:

```env
AUTH_MODE=core
CORE_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego
REGISTRATION_ENABLED=false
```

In this mode Dashboard still keeps chat/runtime data in SQLite, but users and sessions come from PostgreSQL `core.users` / `core.sessions`. Registration is intentionally disabled; create users in Admin instead.

PM outgoing webhooks are configured with:

```env
PM_WEBHOOK_URLS=https://n8n.example/webhook/projectego/pm-events
PM_WEBHOOK_SECRET=<shared-secret>
PM_WEBHOOK_TIMEOUT_MS=5000
PM_WEBHOOK_MAX_ATTEMPTS=6
PM_WEBHOOK_RETRY_BASE_MS=30000
PM_WEBHOOK_RETRY_INTERVAL_MS=15000
```

Each PM event is posted as JSON with:

- `X-ProjectEGO-Event`
- `X-ProjectEGO-Delivery`
- `X-ProjectEGO-Signature: sha256=<hmac>` when `PM_WEBHOOK_SECRET` is set

Webhook delivery attempts are persisted in PostgreSQL in `pm.webhook_deliveries`. Failed deliveries are retried with exponential backoff until `PM_WEBHOOK_MAX_ATTEMPTS`, then marked `dead` for operator inspection instead of being silently lost. The PM browser shell includes a Webhooks operator panel for delivery status, and authenticated PM users can inspect/retry deliveries through `GET /api/pm/webhook-deliveries` and `POST /api/pm/webhook-deliveries/:deliveryId/retry`.

PM operational status is available through `GET /api/pm/operator/status` and the PM shell Ops panel. It reports DB reachability, applied PM schema migrations, webhook queue counts, SMTP configuration, and whether the PM automation token is configured without exposing secret values.

The PM browser shell follows the Dashboard visual system: compact topbar, square status indicators, dark/contrast/custom theme controls, persistent custom colors, operator popovers, and the same monospace panel styling. The Ops panel also exposes a first-run bootstrap form while PM is unbootstrapped, so a TrueNAS deployment can be initialized from the browser after ProjectEGO PM login.

PM SMTP mail is configured with:

```env
SMTP_HOST=mail.project-ego.online
SMTP_PORT=587
SMTP_USERNAME=<smtp-user>
SMTP_PASSWORD=<smtp-password>
SMTP_FROM=pm@project-ego.online
SMTP_TLS=false
```

`GET /api/pm/mail/status` reports whether host/from are configured. `POST /api/pm/projects/:projectId/invites` sends a project invite email. Invites do not create passwords by themselves; create or enable the user in ProjectEGO Admin and grant `pm_access`.

PM automation API is configured with a PM-specific bearer token:

```env
PM_AUTOMATION_TOKEN=<separate-token-for-n8n>
```

n8n should call these routes with `Authorization: Bearer <PM_AUTOMATION_TOKEN>`:

- `GET /api/pm/automation/status`
- `GET /api/pm/automation/projects/boards`
- `GET /api/pm/automation/routing-map`
- `POST /api/pm/automation/projects/:projectId/tasks`
- `POST /api/pm/automation/boards/:boardId/tasks`
- `POST /api/pm/automation/projects/:projectId/boards/default/tasks`
- `PATCH /api/pm/automation/tasks/:taskId`
- `POST /api/pm/automation/tasks/:taskId/move`
- `POST /api/pm/automation/tasks/:taskId/comments`
- `POST /api/pm/automation/tasks/:taskId/dependencies`
- `GET /api/pm/automation/projects/:projectId/tasks/next`

`GET /api/pm/automation/routing-map` and `GET /api/pm/automation/projects/boards` return all visible projects with nested boards, browser paths, and direct automation task-create paths. Use `boards[].apiCreateTaskPath` when n8n needs to create a task on a specific board.

The automation API goes through PM backend authorization and audit paths. n8n should use this API instead of direct PostgreSQL writes for ordinary task operations.

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

Execution status is tracked separately from decision status. Clicking response-level `Apply` records the user decision and creates a backend execution job. Applying selected Draft Inspector items creates an `n8n_apply` job and sends the selected draft payload to `N8N_APPLY_WEBHOOK_URL`; n8n remains responsible for any Plane work-item creation. A green decision square therefore means "user chose Apply", not "n8n/Plane work succeeded".

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
            └── ATTACHMENT_ID.ext
```

Finalized attachment files use internal stored names such as `ATT-mqx4dgx9-5d0fea86.png`. SQLite keeps the user-facing sanitized upload name separately as `originalFileName` and the internal disk/agent name as `storedFileName`. Existing legacy rows without these split fields are still readable.

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
- `.json`
- `.csv`
- `.log`
- `.yml`
- `.yaml`
- `.xml`
- `.ini`
- `.conf`
- `.mp3`
- `.mp4`
- `.jpg`
- `.jpeg`
- `.png`
- `.svg`
- `.webp`

Maximum binary attachment size: 25 MB. Text extraction for LLM requests is controlled separately by `MAX_UPLOAD_BYTES` and `MAX_EXTRACTED_CHARS`.

Attachments are uploaded through `POST /api/uploads`, finalized when the request is sent, linked to the request message in SQLite, and stored as files under `DATA_DIR/attachments`. Text-like files are saved locally, read as UTF-8, stripped of NUL bytes, capped by `MAX_EXTRACTED_CHARS`, and embedded into the existing Codex agent JSON `text` field with `source: "dashboard-upload"` and `fileName` as metadata only. Image attachments can be forwarded to codex-agent as JSON `attachments[]` entries containing secure internal download URLs; image bytes are not inlined as base64. The original file is not uploaded separately to codex-agent. `.mp3` renders with browser audio controls. `.mp4` opens in a movable video preview subwindow. `.jpg`, `.jpeg`, `.png`, `.svg`, and `.webp` render as image previews. Attachment binary data is never stored in SQLite.

For image forwarding, set:

```env
AGENT_ATTACHMENT_TOKEN=change-me
DASHBOARD_INTERNAL_BASE_URL=http://127.0.0.1:19100
MAX_LLM_ATTACHMENT_BYTES=10485760
```

`GET /api/internal/attachments/:attachmentId` is service-to-service only and requires `Authorization: Bearer <AGENT_ATTACHMENT_TOKEN>`. In the reverse-ssh deployment where codex-agent needs to download Dashboard attachments through the VPS, add a reverse forward such as:

```bash
ssh -R 127.0.0.1:19100:192.168.1.237:19100 user@vps
```

## Job Execution Tracking

Response-level decision status and backend execution status are separate:

- decision: `pending`, `applied`, `dropped`, `kept`
- execution: `not_started`, `queued`, `running`, `succeeded`, `failed`, `partial`, `cancelled`

When a response is marked `Apply`, the backend creates a row in `jobs` linked to the conversation, request message, response message, and draft job id when available. Response-level Apply records the decision only. Draft Inspector Apply sends selected draft items to n8n when `N8N_APPLY_WEBHOOK_URL` and `N8N_WEBHOOK_TOKEN` are configured.

Draft Inspector Apply webhook request:

```http
POST <N8N_APPLY_WEBHOOK_URL>
Content-Type: application/json
Authorization: Bearer <N8N_WEBHOOK_TOKEN>
```

Payload shape:

```json
{
  "jobId": "JOB-...",
  "conversationId": "C-...",
  "requestMessageId": "M-...",
  "responseMessageId": "M-...",
  "source": {
    "provider": "codex",
    "codexAgentJobId": "20260621-064612-9149beaf",
    "mode": "create_tasks"
  },
  "items": [
    {
      "draftItemId": "M-response:0",
      "index": 0,
      "title": "...",
      "type": "idea",
      "project": "ProjectEGO",
      "module": "Dashboard",
      "summary": "...",
      "details": "...",
      "priority": "medium",
      "routingConfidence": "medium",
      "labels": [],
      "dependencies": [],
      "acceptanceCriteria": [],
      "needsClarification": [],
      "sourceText": "..."
    }
  ]
}
```

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

For local shared-auth testing, run PostgreSQL/PM migrations first and use:

```env
AUTH_MODE=core
CORE_DATABASE_URL=postgres://projectego_admin:...@127.0.0.1:5432/projectego
REGISTRATION_ENABLED=false
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
AUTH_MODE=core \
CORE_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego \
SESSION_SECRET=<long-random-secret> \
REGISTRATION_ENABLED=false \
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
  -e AUTH_MODE=core \
  -e CORE_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego \
  -e SESSION_SECRET=dev-session-secret \
  -e REGISTRATION_ENABLED=false \
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

For PM as a separate TrueNAS custom app, use:

```text
Image: ghcr.io/autixx/ws-chat-project-ego:latest
Command: node dist/pm/server.js
Pull policy: always
Run as user/group: 568:568
Container port: 19110
Host port: 19110
Volume mount: /app/data
Required env:
  NODE_ENV=production
  PM_HOST=0.0.0.0
  PM_PORT=19110
  PM_DATA_DIR=/app/data
  PM_ATTACHMENTS_DIR=/app/data/attachments
  PM_DATABASE_URL=postgres://projectego_admin:<password>@<postgres-host>:5432/projectego
  PM_PUBLIC_BASE_URL=https://pm.project-ego.online
  PM_TRUST_AUTHELIA_HEADERS=false
  PM_DEV_AUTH_BYPASS=false
  PM_SESSION_SECRET=<long-random-secret>
  PM_COOKIE_SECURE=true
Forbidden env:
  CODEX_AGENT_TOKEN
  AGENT_ATTACHMENT_TOKEN
  JOB_CALLBACK_TOKEN
  N8N_WEBHOOK_TOKEN
  PLANE_API_KEY
  DASHBOARD_INTERNAL_BASE_URL
```

For Admin as a separate TrueNAS custom app, use:

```text
Image: ghcr.io/autixx/ws-chat-project-ego:latest
Command: node dist/admin/server.js
Pull policy: always
Run as user/group: 568:568
Container port: 19120
Host port: 19120
Required env:
  NODE_ENV=production
  ADMIN_HOST=0.0.0.0
  ADMIN_PORT=19120
  ADMIN_DATABASE_URL=postgres://projectego_admin:<password>@<postgres-host>:5432/projectego
  ADMIN_SESSION_SECRET=<long-random-secret>
  ADMIN_COOKIE_SECURE=true
  ADMIN_BOOTSTRAP_USERNAME=admin
  ADMIN_BOOTSTRAP_PASSWORD=<long-random-password>
  ADMIN_BOOTSTRAP_EMAIL=admin@example.local
  ADMIN_BOOTSTRAP_DISPLAY_NAME=ProjectEGO Admin
```

TrueNAS PM first-run order:

1. Deploy PostgreSQL and confirm it is reachable from the PM container.
2. Deploy PM with the env above. PM migrations apply automatically at container startup when `PM_AUTO_MIGRATE=true`.
3. Deploy Admin and sign in as `ADMIN_BOOTSTRAP_USERNAME`.
4. Create or enable users in Admin and grant `dashboard_access` / `pm_access`.
5. Deploy Dashboard with `AUTH_MODE=core` and the same PostgreSQL URL in `CORE_DATABASE_URL`.
6. Optionally put PM behind Authelia/Caddy as an outer perimeter only; do not forward identity headers as app authentication.
7. Sign in through the PM login screen as a user that exists in Admin and has `pm_access=true`.
8. Call `POST /api/pm/bootstrap` with `Authorization: Bearer <PM_BOOTSTRAP_TOKEN>` once, or use the Ops panel to confirm PM is still unbootstrapped before calling it.

To update from the TrueNAS Apps UI:

1. Push changes to GitHub and wait for the `Docker image` Action to finish.
2. Open the app in TrueNAS.
3. Use redeploy/update so TrueNAS pulls the current image.
4. Hard refresh the browser after the container is recreated.

For predictable production rollouts, prefer a fixed tag such as:

```text
ghcr.io/autixx/ws-chat-project-ego:v0.2.26
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

Component status polling runs in the background. `LLM_PROVIDER=codex` requires `CODEX_AGENT_URL` for generation; `CODEX_AGENT_HEALTH_URL` can override the probe URL. n8n reachability polling uses `N8N_BASE_URL`/`N8N_HEALTH_URL`, while Draft Inspector Apply uses `N8N_APPLY_WEBHOOK_URL` plus `N8N_WEBHOOK_TOKEN`. Plane reachability is informational only.

## Caddy + Optional Authelia Perimeter

Dashboard and PM implement their own ProjectEGO authentication. In production with the shared Admin layer, use `AUTH_MODE=core` for Dashboard and PM's built-in login for PM. Authelia can protect the outer perimeter, but neither Dashboard nor PM uses Authelia headers for application login.

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

Admin should be exposed on its own subdomain and can also sit behind the same optional outer protection:

```caddyfile
admin.project-ego.online {
    encode gzip zstd

    import auth_project_ego

    reverse_proxy 127.0.0.1:19120 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

ProjectEGO PM should be proxied like a normal web app. Do not forward `Remote-User`, `Remote-Email`, or `Remote-Name` as PM application identity:

```caddyfile
pm.project-ego.online {
    encode gzip zstd

    import auth_project_ego

    reverse_proxy 127.0.0.1:19110 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

PM does not use Dashboard cookies and does not use Authelia identity headers. It signs in with `POST /api/pm/auth/login`, stores `projectego_pm_session`, and resolves that session against shared `core.users`.

## Authentication

Dashboard supports two authentication modes.

Shared core auth for production:

```env
AUTH_MODE=core
CORE_DATABASE_URL=postgres://projectego_admin:...@projectego-postgres:5432/projectego
```

In shared core auth, users and sessions are stored in PostgreSQL `core.users` and `core.sessions`. Users are created and managed by ProjectEGO Admin. A user must have `dashboard_access=true` to sign in to Dashboard.

PM uses the same `core.users` table and its own login endpoint:

```text
POST /api/pm/auth/login
POST /api/pm/auth/logout
```

A user must have `pm_access=true` or a global admin role to sign in to PM. PM stores its own cookie named `projectego_pm_session`.

Local SQLite auth remains available for isolated development:

```env
AUTH_MODE=local
```

Local auth uses SQLite tables for `users` and `sessions` and is separate from PM/Admin users.

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
| `ATTACHMENTS_DIR` | Optional attachment root. Defaults to `DATA_DIR/attachments`. |
| `SQLITE_PATH` | SQLite database file for chat history. |
| `MAX_UPLOAD_BYTES` | Maximum text-like attachment size for extraction into LLM requests. Defaults to `1048576`. |
| `MAX_EXTRACTED_CHARS` | Maximum extracted characters included in LLM requests. Defaults to `50000`. |
| `MAX_LLM_ATTACHMENT_BYTES` | Maximum image attachment size forwarded to LLM as a download URL. Defaults to `10485760`. |
| `AGENT_ATTACHMENT_TOKEN` | Bearer token required by `/api/internal/attachments/:attachmentId`. |
| `DASHBOARD_INTERNAL_BASE_URL` | Base URL codex-agent can use to download internal attachments, for example `http://127.0.0.1:19100`. |
| `AUTH_MODE` | `core` for shared PostgreSQL users managed by Admin, or `local` for isolated SQLite development auth. |
| `CORE_DATABASE_URL` | PostgreSQL URL for Dashboard shared auth when `AUTH_MODE=core`. Defaults to `PM_DATABASE_URL` if unset. |
| `SESSION_SECRET` | Required in production for session hashing. |
| `REGISTRATION_ENABLED` | Enables or disables new local registrations. |
| `REGISTRATION_INVITE_CODE` | Required invite code when registration is enabled. |
| `COOKIE_SECURE` | Sets the secure flag on session cookies. |
| `DEV_AUTH_BYPASS` | Legacy env retained but not used for local auth access control. |
| `TRUST_AUTHELIA_HEADERS` | Legacy env retained but not used for local auth access control. |
| `LLM_PROVIDER` | `mock` or `codex`. |
| `CODEX_AGENT_URL` | Optional HTTP endpoint for Codex provider, for example `http://192.168.1.237:19090/v1/projectego/process`. |
| `CODEX_AGENT_HEALTH_URL` | Optional health URL for LLM-agent reachability polling. |
| `CODEX_AGENT_TOKEN` | Optional token sent as `X-Codex-Agent-Token` to non-health Codex agent routes. |
| `CODEX_FALLBACK_TO_MOCK` | Fall back to mock if Codex is not configured. |
| `PLANE_BASE_URL` | Optional Plane base URL for informational reachability. |
| `PLANE_HEALTH_URL` | Optional Plane health URL for reachability polling. |
| `PLANE_WORKSPACE` | Plane workspace slug. |
| `PLANE_API_KEY` | Optional Plane API key retained for future integration; Dashboard is not a Plane writer. |
| `N8N_BASE_URL` | Optional n8n base URL. |
| `N8N_HEALTH_URL` | Optional n8n health URL for reachability polling. |
| `N8N_APPLY_WEBHOOK_URL` | Optional n8n webhook URL used by Draft Inspector Apply. |
| `N8N_WEBHOOK_TOKEN` | Optional n8n webhook token sent as `Authorization: Bearer ...` for Draft Inspector Apply. |
| `JOB_CALLBACK_TOKEN` | Optional bearer token for `POST /api/jobs/:jobId/events`. Required before workflow callbacks are accepted. |
| `COMPONENT_STATUS_INTERVAL_MS` | Component reachability polling interval. Default `15000`. |
| `COMPONENT_STATUS_TIMEOUT_MS` | Per-probe timeout. Default `2000`. |
| `PM_SESSION_SECRET` | PM session HMAC secret. Defaults to `SESSION_SECRET` if unset. |
| `PM_COOKIE_SECURE` | Sets the secure flag on PM cookies. Defaults through `COOKIE_SECURE` if unset. |
| `ADMIN_HOST` | Admin service bind host. |
| `ADMIN_PORT` | Admin service port, default `19120`. |
| `ADMIN_DATABASE_URL` | PostgreSQL URL for Admin. Defaults to `PM_DATABASE_URL` if unset. |
| `ADMIN_SESSION_SECRET` | Admin session HMAC secret. Defaults to `SESSION_SECRET` if unset. |
| `ADMIN_COOKIE_SECURE` | Sets the secure flag on Admin cookies. |
| `ADMIN_BOOTSTRAP_USERNAME` | Optional startup superuser username. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Optional startup superuser password. |
| `ADMIN_BOOTSTRAP_EMAIL` | Optional startup superuser email. |
| `ADMIN_BOOTSTRAP_DISPLAY_NAME` | Optional startup superuser display name. |

Codex agent example:

```env
CODEX_AGENT_URL=http://192.168.1.237:19090/v1/projectego/process
CODEX_AGENT_HEALTH_URL=http://192.168.1.237:19090/healthz
```

## Current Limitations

- Plane work-item creation is out of scope for Dashboard; route execution through n8n.
- `CodexProvider` is non-streaming unless the configured backend streams or returns incremental events.
- SQLite is intended for single-node deployment.
- Self-service password reset, email verification, and login rate limiting are not implemented yet.
- No Telegram integration.
- Admin manages global user access flags; fine-grained PM permissions remain project-level roles.

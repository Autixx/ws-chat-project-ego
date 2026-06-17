# ProjectEGO WebSocket Chat Workbench

Browser chat/workbench for ProjectEGO planning automation. The app keeps persistent conversations in SQLite, streams WebSocket events to the browser, and preserves the existing ProjectEGO draft workflow as chat artifacts.

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
{"status":"ok","service":"projectego-ws-chat"}
```

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
3. Create a conversation or let the app create one.
4. Send `Chat`, `Digest`, `Tasks`, or `Abstract idea`.
5. Confirm the message history persists after reload.
6. For draft modes, open the draft inspector.
7. Choose Apply/Keep/Drop per item.
8. Click `Apply selected`.

If Plane is not configured, the app returns `Plane integration is not configured.` and stores kept items in unclarified storage.

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
- `CodexProvider` is non-streaming unless the configured backend streams or returns incremental events.
- SQLite is intended for single-node deployment.
- No database-backed full-text search yet.
- No Telegram integration.
- No custom login; Authelia remains the authentication layer.

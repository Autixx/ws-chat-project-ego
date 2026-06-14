# ProjectEGO WebSocket Chat Gateway

Production-oriented MVP for a browser-based WebSocket chat interface that can later replace the Telegram bot as the primary ProjectEGO planning automation UI.

The app provides its own HTTP/WebSocket server. n8n and Plane are optional integrations and are not required for local MVP usage.

## Features

- Express HTTP server with `GET /health`.
- WebSocket endpoint at `GET /ws`.
- Authelia header auth helper with local development bypass.
- Strict JSON WebSocket protocol for digest, tasks, apply, discard, unclarified, and clarify actions.
- LLM provider abstraction with `MockProvider` and configurable `CodexProvider` placeholder.
- Disk draft storage under configurable `DATA_DIR`.
- Unclarified item storage with global `U-000001` IDs.
- Apply/keep/drop selection grammar parser.
- Static browser UI with prompt input, `.txt` / `.md` upload, live stream output, draft preview, item choices, and debug panel.

## Requirements

- Node.js 20+
- npm

## Install

```bash
npm install
```

## Development Run

```bash
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:19100`.

For local development, keep:

```env
DEV_AUTH_BYPASS=true
TRUST_AUTHELIA_HEADERS=false
LLM_PROVIDER=mock
DATA_DIR=./data
```

## Production Run

```bash
npm run build
NODE_ENV=production HOST=127.0.0.1 PORT=19100 DATA_DIR=/var/lib/projectego-ws-chat DEV_AUTH_BYPASS=false TRUST_AUTHELIA_HEADERS=true npm start
```

Runtime data is written only to `DATA_DIR`. Do not point `DATA_DIR` inside `dist` or another immutable application directory.

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
  -e DATA_DIR=/data \
  -e DEV_AUTH_BYPASS=true \
  -e TRUST_AUTHELIA_HEADERS=false \
  -v projectego-ws-chat-data:/data \
  projectego-ws-chat:local
```

Compose example:

```bash
docker compose up --build
```

The image exposes one HTTP/WebSocket port: `19100`. Mount `/data` or set `DATA_DIR` to another mounted path. Runtime drafts and unclarified items are not stored inside the image.

## Health Check

```bash
curl http://127.0.0.1:19100/health
```

Response:

```json
{"status":"ok","service":"projectego-ws-chat"}
```

## WebSocket Protocol

Client messages:

- `digest`: `{ "type": "digest", "text": "string", "fileName": "optional string" }`
- `tasks`: `{ "type": "tasks", "text": "string", "fileName": "optional string" }`
- `apply`: `{ "type": "apply", "jobId": "latest", "expression": "1,2 keep 3 drop other" }`
- `discard`: `{ "type": "discard", "jobId": "latest" }`
- `show_unclarified`: `{ "type": "show_unclarified" }`
- `clarify`: `{ "type": "clarify", "unclarifiedId": "U-000001", "text": "clarification" }`

Server events include `connected`, `status`, `token`, `draft_saved`, `draft_result`, `apply_result`, `unclarified_index`, and `error`.

## MockProvider Test

1. Start with `LLM_PROVIDER=mock`.
2. Open the UI.
3. Paste text or upload a `.txt` / `.md` file.
4. Click `Digest` or `Tasks`.
5. Watch status/token events.
6. Confirm a numbered draft appears.
7. Select Apply/Keep/Drop choices and click `Apply selected`.
8. If Plane env is missing, the app reports `Plane integration is not configured.` and stores kept items under `DATA_DIR/unclarified`.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind host. Use `0.0.0.0` in Docker. |
| `PORT` | `19100` | Single HTTP/WebSocket port. |
| `DATA_DIR` | `./data` | Runtime draft and unclarified storage. Use a mounted volume in Docker. |
| `DEV_AUTH_BYPASS` | dev defaults true | Enables local fake user. Must be false in production. |
| `TRUST_AUTHELIA_HEADERS` | `false` | Trusts `Remote-*` headers from Authelia/Caddy. |
| `LLM_PROVIDER` | `mock` | `mock` or `codex`. |
| `CODEX_AGENT_URL` | empty | Optional HTTP endpoint for Codex provider. |
| `CODEX_AGENT_TOKEN` | empty | Optional bearer token for Codex provider. |
| `CODEX_FALLBACK_TO_MOCK` | `true` | Falls back to mock if Codex is not configured. |
| `PLANE_BASE_URL` | empty | Optional Plane API base URL. |
| `PLANE_WORKSPACE` | `projectego` | Plane workspace slug. |
| `PLANE_API_KEY` | empty | Optional Plane API key. |
| `N8N_BASE_URL` | empty | Optional n8n base URL. |
| `N8N_WEBHOOK_TOKEN` | empty | Optional n8n webhook token. |

## Authelia

This app does not implement username/password login. In production it should sit behind Caddy and Authelia. When `TRUST_AUTHELIA_HEADERS=true`, the backend reads:

- `Remote-User`
- `Remote-Groups`
- `Remote-Email`
- `Remote-Name`

If auth headers are missing and `DEV_AUTH_BYPASS=false`, WebSocket upgrades are rejected with `401 Unauthorized`.

## Caddy Example

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

## Apply Grammar

Examples:

```text
all
1,2,3
1,2,3 keep 4,5 drop 6
keep 4,5 drop 6
1,2 drop other
keep 4,5 drop other
all drop 4,5
```

Rules:

- If no explicit apply list is provided, apply all except keep/drop.
- Unmentioned items default to keep.
- Drop wins over apply and keep.
- Apply wins over keep.

## Known Limitations

- `CodexProvider` is an HTTP placeholder. Real token streaming depends on the future Codex/local LLM endpoint contract.
- Plane creation is intentionally guarded until project ID mapping is configured.
- n8n client is a stub for later webhook workflows.
- Runtime storage is file-based and suitable for MVP/single-node deployment, not concurrent multi-node operation.
- Frontend file upload reads `.txt` / `.md` as UTF-8 plain text and does not render Markdown.

# n8n Integration Architecture & Security Contracts

Status: **implemented as a managed application adapter plus hybrid external/SSH connect**.
No n8n source code, node definitions, or container images are copied or vendored into MSO
(respecting n8n's Sustainable Use License). MSO owns only the catalog entry, split-origin
HTTP/WebSocket proxy, SHA-256-pinned Docker lifecycle adapter (`scripts/managed-app-n8n`),
and low-code local/remote/SSH connection wizard.

Target: official upstream multi-architecture image `docker.n8n.io/n8nio/n8n` pinned by
immutable `@sha256` digest in `security/managed-app-artifacts.env`, bound to loopback
`127.0.0.1:5678` by default with persistent user data in `~/.n8n`.

## 1. Split-origin framing, cookies & WebSocket push

- **Loopback default**: `scripts/managed-app-n8n` binds `127.0.0.1:5678:5678` unless the
  operator explicitly opts into `N8N_EXPOSE_PUBLIC=1`.
- **WebSocket push**: MSO starts n8n with `N8N_PUSH_BACKEND=websocket` so live workflow
  updates flow through MSO's continuously-authorized WebSocket relay (`scripts/server.mjs`
  + `lib/managed-apps/socket-policy.ts`) rather than hitting HTTP fetch timeouts on SSE.
- **Origin & cookie isolation**: `N8N_SECURE_COOKIE=false` on loopback lets MSO's
  split-origin proxy (`lib/managed-apps/proxy-headers.ts`) wrap upstream cookies into
  host-only `__Host-mapp_n8n_*` cookies on `https://n8n.<managed-app-host>` while keeping
  cockpit cookies completely isolated.
- **External / Remote instances**: Operators already running n8n elsewhere can connect an
  external HTTPS URL (`~/.mso/surface-apps.json` or `N8N_PUBLIC_URL`) or a loopback SSH
  tunnel (`~/.mso/remote-tunnels.json`) without installing a local container.

## 2. Lifecycle, backups & non-destructive uninstall

- **Install / Update**: `scripts/managed-app-n8n install` / `update --yes` verifies the
  pulled image against the locked `@sha256` digest before starting and waits for `/healthz`.
- **Port safety**: aborts cleanly if another Docker container holds port `5678`.
- **Uninstall**: `uninstall --yes [--dry-run]` stops and removes only the `n8n` container
  while preserving `~/.n8n` workflows, credentials, and SQLite data.
- **Local discovery**: `GET /api/v1/managed-apps/discover` detects foreign Docker
  containers, active loopback ports, and existing `~/.n8n` folders read-only without
  silently adopting lifecycle ownership.

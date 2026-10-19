# Orca Web Integration Architecture & Security Contracts

Status: **Local Development Candidate** (Not shipped to main or deployed)  
Target Version: Orca IDE v1.4.230 (Node-only headless `orcad` daemon)

---

## 1. Split-Origin Architecture Requirement

MSO embeds vendor web dashboards strictly through dedicated subdomains/hosts (e.g. `orca.mso.example.com`) defined by `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE="{id}.mso.example.com"`:

- **Cross-Origin Boundary**: The iframe runs with `allow-same-origin` so the Orca web client can use its own cookies, IndexedDB, and Web Workers. Because it runs on a separate host from the cockpit (`mso.example.com`), `window.top` is opaque and cannot call `/api/v1/exec` or access MSO session cookies.
- **No Same-Origin Fallback**: Deployments without a host template disable iframe embedding; MSO falls back to the CLI terminal view.
- **CSP Frame-Ancestors**: The proxy injects `frame-ancestors https://mso.example.com`, preventing third-party clickjacking or embedding outside the MSO cockpit.

---

## 2. Shared Operator Workspace & Terminal Semantics

As documented in `PAIRING-DECISION.md`:
- **Single Unix Principal**: MSO runs as a dedicated Unix user on the host. All MSO Operators share access to the running `orcad` workspace and terminals.
- **Upstream Authorization Gap**: Orca v1.4.230 does not support per-device revocation or multi-tenant access control at the RPC layer.
- **Outer Gate Enforcement**: Security relies on the outer MSO gate:
  - Live authorization requires `operator` or `owner` role.
  - Active WebSocket connections are monitored with an idle/re-check timer against the MSO device store.
  - Viewer role devices and revoked sessions are denied access at the HTTP proxy and WebSocket upgrade boundaries.

---

## 3. Node-Only Headless Daemon (`orcad`)

- **No Electron / Display Server**: Orca is run purely via Node 24.21.0 invoking the upstream `orcad` server entrypoint.
- **Loopback Bind**: The daemon listens strictly on `127.0.0.1:6769`. It must never bind to `0.0.0.0` or a public network interface.
- **Static Asset Serving**: Static web client files are served from `/web-index.html` and associated assets.

---

## 4. Port 6769 & Collision Isolation

- **Port Allocation**: Managed Orca uses port **6769** (configurable via `ORCA_DASHBOARD_URL`).
- **Collision Avoidance**: Default port 6768 is avoided to prevent collisions with user-owned desktop instances or background processes running out of `~/.orca` or `~/.orca-remote`.
- **Private Managed State**: MSO stores managed state and private status in `~/.local/share/mso/orca` (or `ORCA_HOME`), isolating it from the user's personal configuration.

---

## 5. Bootstrap Credentials & Pairing Flow

1. **Session Endpoint**: Authenticated Operators query `GET /api/v1/managed-apps/orca/session` (`Cache-Control: no-store`).
2. **Private Readiness Verification**: The server verifies `private-status.json` (version 1.4.230, port 6769, live terminal daemon, process PID, valid pairing offer).
3. **Fragment-Based Delivery**:
   - The client URL contains `#pairing=<token>&app_ticket=<ticket>`.
   - Secrets are never placed in URL query parameters or server logs.
4. **Ticket Exchange**:
   - The bootstrap script sends `POST /__mso_app_auth` with `Authorization: Bearer <ticket>`.
   - Upon successful verification, an HttpOnly Secure `__Host-mso-managed-app` cookie is minted.
   - The ticket is stripped from `window.location.hash`, preserving the `#pairing=<token>` fragment.
   - The page reloads, allowing Orca's web client to initialize with the pairing token while using the authenticated session cookie.

---

## 6. Containment & Unsupported Capabilities

- **Desktop Automation**: Disabled (`grantDesktopControl: false`, `grants: []`). The RPC permission `desktop-control` is not granted.
- **Service Workers**: Rejected at proxy boundary (`Sec-Fetch-Dest: serviceworker` returns 404 regardless of path or extension).
- **CSP**:
  - `worker-src`: Restricted to exact app root plus `blob:`.
  - `script-src`: Grants `'wasm-unsafe-eval'` for Orca WebAssembly modules; strictly forbids `'unsafe-eval'`.
- **WebSocket Upgrade**: Requires exact same-origin HTTPS `Origin` header matching `https://orca.mso.example.com`.
- **Lifecycle & Updates**: Automated install, update, and rollback remain disabled (`installBackends: []`, `commandProvesInstall: false`) pending verified packaging in subsequent checkpoints.

# Orca Web Integration Architecture & Security Contracts

Status: **local development candidate** on the task branch. Not merged, released, or
deployed, and not claimed live: no real Orca runtime, browser journey, or upstream install has
been executed as part of this worktree. The MSO-owned installer/adapter, the pinned-release
lifecycle, and the manager ownership rule below are implemented and covered by dry-run/unit
fixtures; the live service install remains the operator's explicit action.

Target: Orca IDE v1.4.230, Node-only headless `orcad` server.

---

## 1. Split-origin requirement

MSO embeds vendor web dashboards strictly through dedicated subdomains/hosts (e.g.
`orca.mso.example.com`) defined by `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE="{id}.mso.example.com"`:

- **Cross-origin boundary**: the iframe runs with `allow-same-origin` so the Orca web
  client can use its own cookies, IndexedDB, and Web Workers. Because it runs on a host
  separate from the cockpit, `window.top` is opaque and `/api/v1/exec` does not exist on
  that origin.
- **No same-origin fallback**: a deployment without a host template disables iframe
  embedding; MSO falls back to the CLI view. There is deliberately no path-on-cockpit mode.

## 2. Shared operator workspace & terminal semantics

Per `PAIRING-DECISION.md`:

- **Single Unix principal**: all MSO Operators share the one running `orcad` workspace and
  terminals.
- **Upstream authorization gap**: Orca v1.4.230 has no per-device revocation or multi-tenant
  RPC authorization. MSO does not invent one.
- **Outer gate**: HTTP and WebSocket access require a live Operator/Owner role and an active
  MSO device session; active sockets are re-authorized on the existing chunk/idle timer.
  Viewer or revoked devices are denied at the proxy and upgrade boundaries. Retaining an
  upstream key does not bypass the MSO gate. This is **not** upstream row deletion and is not
  a per-device upstream grant surface.

## 3. Runtime readiness (fail closed)

`getOrcaReadiness()` is unavailable unless **all** of the following hold. There is no static
fallback and no "live PID" shortcut.

- `private-status.json` carries the exact tag `type: "orca_server_ready"`, `schemaVersion: 1`,
  a non-empty `runtimeId`, `health.buildVersion === "1.4.230"`, `health.nodeVersion === "24.21.0"`,
  `health.nodeAbi === "137"`, a positive `health.pid`, and a live terminal daemon
  (`state: "live"`, `ownsFreshSessions: true`, `selfTest.ok: true`). An `artifactVersion`
  field can never override the real `health.buildVersion`.
- The bound endpoint is `ws://127.0.0.1:<managed-port>` — loopback, no credentials, path,
  query, or fragment. The managed port comes from config (default 6769); the user's existing
  6768 listener is never adopted.
- The advertised endpoint is the exact configured WSS origin with no credentials, path,
  query, or fragment.
- Pairing is available with an **explicit** `scope: "runtime"` and a valid offer (section 6).

## 4. Private state root and identity receipt

- Managed root is MSO-owned state: `~/.local/share/mso/orca`, or a clean absolute `ORCA_HOME`.
  An invalid `ORCA_HOME` fails the bridge closed; it never falls back to the owner's personal
  `~/.orca`/`~/.orca-remote`.
- `private-status.json` is 0600 under a 0700 owner directory. Reads reject symlinked ancestors
  and symlinked leaves, open `O_NOFOLLOW`, bound the size before any byte moves, and re-check
  file identity after reading.
- `runtime-identity.json` is **mandatory** (schema 1): `runtimeId`, `version`, `serverPid`,
  `serverStartTicks`, `nodeBinary`, `serverEntry`, `userData`, `boundEndpoint`,
  `advertisedEndpoint`, `readyAt`. Its paths must be contained in the managed root
  (release slot under `releases/`, profile at `runtime/user-data`).

## 5. Process identity

The receipt's `serverPid` must equal `private-status.health.pid` and resolve to the exact
owned kernel process. Verification reads only `/proc/PID/stat` (field 22 start time,
comm-safe parsing), `/proc/PID` owner UID, `/proc/PID/exe`, and `/proc/PID/cmdline` — **never**
`/proc/PID/environ` or credentials. PID, start ticks, UID, canonical executable, and server
script argv must all match. A missing, reused, foreign, unreadable, or EPERM process yields
`unavailable`, never a blessing.

## 6. Pairing offer and delivery

- The offer must be scope `runtime`, bound to the **exact** configured WSS origin (no relay,
  no userinfo/path/query/fragment), with well-formed token/key material. Absent scope (the
  upstream legacy/mobile shape), relay offers, and any grant claim are refused. Upstream does
  not encode grants in this offer, so MSO cannot and does not certify upstream permissions.
- MSO constructs the one frameable URL itself:
  `https://<app-origin>/web-index.html#pairing=<encodeURIComponent(pairingUrl)>`. An
  upstream-provided `webClientUrl` is never trusted. The credential lives in the fragment
  only — never a query, a log, or a cookie.
- Non-Orca managed apps never accept a server-supplied navigation URL; a `webClientUrl` on
  another app's response is refused.

## 7. Session route and UI

`GET /api/v1/managed-apps/[id]/session` returns `no-store` always. Non-Operator/Viewer/
unauthenticated callers get 401; a missing split origin gets 404; an unavailable Orca gets
503 with a safe reason enum and no pairing/ticket material. The client aborts a stale in-flight
authorization and invalidates prior authorization before resolving, so a revoked or refreshed
session cannot remount an old frame. A revoked MSO session fails at the live proxy; the client
does not delete upstream rows.

> The Managed Apps panel's `healthy` flag still reflects static HTTP reachability of
> `/web-index.html`. That is a liveness hint only. Browser pairing is gated by the full
> readiness/identity check above, not by that flag.

## 8. Containment & unsupported capabilities

- **Service workers**: rejected at the proxy boundary (`Sec-Fetch-Dest: serviceworker` → 404,
  any path).
- **CSP**: `worker-src` limited to the app root plus `blob:`; `script-src` allows
  `'wasm-unsafe-eval'` (never `'unsafe-eval'`).
- **WebSocket upgrade**: exact same-origin HTTPS `Origin` matching the configured Orca host.
- **Lifecycle**: install is offered only through MSO's own managed installer
  (`installBackends: ["user-systemd"]`); update/uninstall/desktop-control remain disabled and
  `commandProvesInstall: false`. Pairing offers claiming desktop control are refused.
- **Manager ownership (fail closed)**: the manager treats Orca as installed ONLY when the exact
  USER unit `~/.config/systemd/user/mso-orca.service` is a regular, owner-owned file (no
  symlink) carrying MSO's marker + fixed `scripts/orca/cli.mjs run --managed-root …` argv AND a
  verified install receipt (`managed-install.json`, rehashed through the adapter). A same-name
  SYSTEM unit, a wrong-scope unit, or a missing/invalid receipt is `not-installed` with a
  diagnostic; start/stop/restart/logs act on the user unit only and never fall through to a
  foreign system unit.
- **First-install rollback**: a first install that fails after writing the unit stops only the
  exact unit MSO created, restores/removes the prior owned config/unit/receipt, and — if that
  rollback cannot finish — leaves an explicit `partial-install.json` marker so the next install
  refuses rather than adopt a half state. An absent unit is published with an exclusive
  hardlink, so a foreign unit created at the last instant is never overwritten.
- **Not verified here**: pinned installer execution, live browser/worker/WASM journey, and
  end-to-end runtime start are out of this slice and must be proven with real artifacts before
  any "verified" claim.

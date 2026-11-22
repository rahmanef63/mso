# Hybrid Svelte + Rust Shell Cutover Runbook

> **Scope & safety contract.** Production stays on Next.js by default (`runtime = next` via
> `MSO_RUNTIME=next` or unset). Switching to the hybrid Svelte 5 static UI + Rust shell host
> (`mso-shell-host`) is strictly opt-in, automatically fail-safe back to `next` when prerequisites
> are missing, reversible with zero state conversion, and never mutates `~/.mso` (sessions, device
> approvals, secrets, or stored state). See [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) and
> [`SVELTE-IMPLEMENTATION.md`](./SVELTE-IMPLEMENTATION.md) for architecture and milestone gates.

## Scope & safety contract

- **Default runtime remains `next`:** `scripts/hybrid-runtime.mjs` defaults to `runtime: "next"`
  and falls back to `next` if `MSO_RUNTIME` is unset, unknown (`unsupported_runtime`), or if any
  hybrid prerequisite fails validation (`missing_rust_binary`, `missing_svelte_build`,
  `invalid_loopback_api_origin`, `invalid_port`, or `missing_native_fs_root`).
- **Zero state mutation:** Hybrid mode shares the existing loopback MSO backend API and leaves
  `~/.mso` completely untouched. No migration or state conversion is required on cutover or
  rollback.
- **Strict loopback and host boundaries:** `mso-shell-host` binds strictly to `127.0.0.1`, accepts
  only loopback `--api-origin` targets (`127.0.0.1`, `[::1]`, or `localhost` without credentials,
  paths, or queries), never widens CORS, cookie domains, or public binds, and keeps production
  TLS termination behind the existing operator proxy (for example `https://mso.example.com`).
- **Cutover gate:** Do not switch a live `mso.service` unit from `next` to `hybrid` until every
  preflight check, automated cutover/rollback drill, same-host benchmark, and real-device
  verification checklist item below has passed on the target host.

## 1. Build & preflight checks

Run all commands from the canonical repository root before attempting any opt-in hybrid start.

### 1.1 Build and test the Rust shell workspace

```sh
cd rust-shell && cargo test --workspace && cargo build --release --bin mso-shell-host
```

For strict warning-free release verification (matching [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)):

```sh
cd rust-shell && RUSTFLAGS="-D warnings" cargo test --workspace && cargo build --release --bin mso-shell-host
```

Expected artifact: `rust-shell/target/release/mso-shell-host` (zero external crates).

### 1.2 Check, build, and test the Svelte static shell

```sh
bun run svelte:check && bun run svelte:build && bun run svelte:e2e
```

Optional static audit and live Rust host browser smoke:

```sh
bun run svelte:audit
(cd frontend/svelte && bun run test:rust-host)
```

Expected artifact: `frontend/svelte/build/index.html` and static chunk assets.

### 1.3 Validate hybrid runtime selection (fail-safe preflight)

```sh
node scripts/hybrid-runtime.mjs --check \
  --runtime=hybrid \
  --rust-bin=rust-shell/target/release/mso-shell-host \
  --assets=frontend/svelte/build \
  --api-origin=http://127.0.0.1:4005
```

Optional flags supported by `scripts/hybrid-runtime.mjs`:

| Flag | Default / env | Purpose |
|---|---|---|
| `--runtime` | `MSO_RUNTIME` or `next` | Selects `next` or `hybrid` |
| `--rust-bin` | `MSO_RUST_SHELL_BIN` or `rust-shell/target/release/mso-shell-host` | Path to compiled `mso-shell-host` binary |
| `--assets` | `MSO_SVELTE_BUILD_DIR` or `frontend/svelte/build` | Path to Svelte static build containing `index.html` |
| `--api-origin` | `MSO_SVELTE_API_ORIGIN` | Required loopback backend origin (`http(s)://127.0.0.1:<port>`, `[::1]`, or `localhost`) |
| `--port` | `4174` | Loopback listen port (`0..65535`) for `mso-shell-host` |
| `--managed-host-template` | `NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE` | Optional split-origin managed-app host template |
| `--native-metrics` | off | Opt-in Stage R4 Linux `/proc` metrics handler |
| `--native-fs-root <dir>` | off | Opt-in Stage R4 jailed filesystem root directory |
| `--rollback-plan` | off | Includes machine-readable `rollbackPlan` in JSON output |
| `--sha <sha>` | unset | Embeds `lastKnownGoodSha` into `rollbackPlan` |

Verify the JSON output reports `"runtime": "hybrid"`, `"fallback": false`, `"reason": null`,
non-null `"command"`, and exact `"args"` before proceeding. If `"fallback": true`, resolve the
reported `"reason"` and re-run.

## 2. Automated cutover & rollback drill

Run the automated cutover rehearsal and same-host benchmark on the target host:

```sh
node scripts/cutover-drill.mjs
node scripts/bench-hybrid-same-host.mjs
```

- **`node scripts/cutover-drill.mjs`**: rehearses selecting `hybrid`, verifying live host
  readiness (`/healthz`, static shell response with CSP nonce, API proxy/native boundaries, and
  blocked endpoints), and rolling back to `next` with zero `~/.mso` state conversion.
- **`node scripts/bench-hybrid-same-host.mjs`**: spawns `mso-shell-host` against a temporary
  jailed directory and a same-host loopback synthetic Node fixture, reporting JSON with:
  - host metadata (`gitSha`, `nodeVersion`, `cpus`, `totalMemMiB`, `platform`, `arch`),
  - `startupReadyMs` (`MSO_RUST_SHELL_READY` emission time), `idleRssKiB`, `activeRssKiB`, and
    `healthzLatencyMs`,
  - `rootHtmlCspTtfb` (50 requests verifying `Content-Security-Policy`, `X-Nonce`, and matching
    inline script nonce),
  - `nativeSysStats` (100 requests to `/api/v1/sys/stats` verifying `X-Mso-Native-Handler: sys_metrics`),
  - `nativeFsSearch` (50 requests to `/api/v1/fs/search?q=bench` verifying
    `X-Mso-Native-Handler: fs_jail` and `.env` exclusion),
  - `upstreamCallsDuringNative` (must equal `0`).

> **Measurement boundary:** `scripts/bench-hybrid-same-host.mjs` compares against a synthetic
> loopback JSON server fixture, not full Next.js SSR. Record the live JSON output from your own
> target host and never quote synthetic numbers as production SLA claims. Reference Wave 9
> Linux x86_64 synthetic-fixture baselines live in [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md).

## 3. Opt-in Stage R4 native flags

Stage R4 native handlers are **disabled by default**. Without these flags, `mso-shell-host`
proxies API requests to `--api-origin`. Both flags require a valid `session=` cookie (`401`
without), enforce `GET`-only methods (`405` on mutations), and enforce CSRF `Sec-Fetch-Site`
rejection (`403` on cross-site requests).

### 3.1 `--native-metrics`

- Serves Linux `/proc`-backed host telemetry directly in Rust (`X-Mso-Native-Handler: sys_metrics`,
  zero upstream Node calls) for:
  - `GET /api/v1/sys/stats` (CPU delta from `/proc/stat`, memory from `/proc/meminfo`, uptime from
    `/proc/uptime`),
  - `GET /api/v1/sys/processes` (Linux `/proc` process table).
- Leave disabled on non-Linux hosts or whenever Node-side metrics adapters are required.

### 3.2 `--native-fs-root <dir>`

- Serves jailed read-only filesystem endpoints directly in Rust (`X-Mso-Native-Handler: fs_jail`,
  zero upstream Node calls) for:
  - `GET /api/v1/fs/list` (bounded to `MAX_LIST_ENTRIES = 500`, skips sensitive entries and
    escaping symlinks),
  - `GET /api/v1/fs/read` (UTF-8 text reads bounded to `DEFAULT_MAX_READ_BYTES = 512 KiB`),
  - `GET /api/v1/fs/search` (bounded to `MAX_SEARCH_DEPTH = 10`, skips `.git`, `node_modules`, and
    symlinks),
  - `GET /api/v1/fs/usage` (jailed path usage summary).
- The directory must exist and resolve to a directory; `scripts/hybrid-runtime.mjs` falls back to
  `next` (`missing_native_fs_root`) if the path is missing.
- **`fs_jail` security guarantees:**
  - Rejects absolute paths, NUL bytes, backslashes, `..` segments, and symlinks resolving outside
    the canonicalized `--native-fs-root`.
  - Enforces a case-insensitive credential and secret denylist blocking `.env`, `.env.*`, `.ssh`,
    `.gnupg`, `.aws`, `.kube`, `.mso`, `id_rsa`, `id_ed25519`, `credentials.json`, `*.pem`,
    `*.key`, `secrets.*`, and `tokens.*` (including symlinks targeting denied paths).

### 3.3 Hard-blocked endpoints & host security invariants

Regardless of whether Stage R4 flags are enabled or omitted, `mso-shell-host` preserves these
non-negotiable invariants:

- `/api/config`, `/api/v1/exec/run`, and `/api/v1/editor/exec` remain unlisted and return
  **`404 Not Found`** on all HTTP methods.
- Every HTML response carries a per-request CSP nonce (`Content-Security-Policy` and `X-Nonce`).
- Request bodies remain bounded (`413`), CSRF depth-2 checks stay active, and multi `Set-Cookie`
  headers are preserved without widening cookie domains or CORS.

Example preflight check with both Stage R4 flags enabled:

```sh
node scripts/hybrid-runtime.mjs --check \
  --runtime=hybrid \
  --rust-bin=rust-shell/target/release/mso-shell-host \
  --assets=frontend/svelte/build \
  --api-origin=http://127.0.0.1:4005 \
  --native-metrics \
  --native-fs-root=/path/to/jailed-workspace
```

## 4. Real-device & iOS PWA standalone verification checklist

Complete every check against the HTTPS operator origin (for example `https://mso.example.com`)
before declaring a live host cutover verified. Record pass/fail status and device/browser versions
in the rollout log.

### 4.1 Desktop Chromium & Firefox

- [ ] Cold load `/` returns HTTP 200 with `Content-Security-Policy` + `X-Nonce` headers and zero
      console or CSP errors.
- [ ] Sign-in succeeds, session persists across hard reload, and logout clears the active session.
- [ ] Owner device approval, role update, and inline revoke work end to end.
- [ ] AppShell multi-window operations (open, move, resize, close, URL sync, layout persistence,
      and per-window crash boundary isolation) work across light and dark themes.
- [ ] Terminal (`os-terminal` PTY + live SSE) and Assistant (`POST /api/assistant` incremental SSE,
      Stop, Retry) stream cleanly without stalls.
- [ ] Managed-app split-origin routing and WebSocket tunnel work if `--managed-host-template` is
      configured.
- [ ] Blocked routes (`/api/config`, `/api/v1/exec/run`, `/api/v1/editor/exec`) return `404`.
- [ ] If Stage R4 flags are enabled: System Monitor displays stats/processes, Files displays
      list/read/search/usage, and `.env` / `.mso` / `.ssh` paths remain hidden or denied.

### 4.2 Narrow mobile viewport (390px)

- [ ] Viewport at 390px width renders without horizontal overflow or clipped primary actions across
      `ios`, `android`, and `dashboard` chrome profiles.
- [ ] Modals, 4-tab Settings, Files navigation, and Assistant composer remain reachable with touch
      input and on-screen keyboard / IME composition.
- [ ] Window switching, close buttons, and two-step confirmation dialogs remain legible and
      tappable in both light and dark themes.

### 4.3 iOS Safari standalone PWA

- [ ] Adding `https://mso.example.com` to the iOS Home Screen launches in standalone display mode
      (`display-mode: standalone`) without unexpected bounce to full Safari on same-origin routes.
- [ ] Top status bar / notch / Dynamic Island and bottom Home Indicator respect safe-area insets
      (`env(safe-area-inset-top/bottom/left/right)`) in both portrait and landscape orientations.
- [ ] Login cookie persists across app backgrounding, force-quit, and relaunch over HTTPS
      (`/api/auth/me` stays authenticated).
- [ ] SSE streams for `os-terminal` and `assistant` stay responsive during normal use and recover
      cleanly (or surface explicit retry/reconnect) after brief iOS background suspension.

## 5. Zero-data-loss rollback procedure

Because hybrid mode performs no migration on `~/.mso`, rollback is immediate and lossless.

### 5.1 Record the rollback plan and `lastKnownGoodSha` before cutover

```sh
LAST_GOOD_SHA="$(git rev-parse HEAD)"
node scripts/hybrid-runtime.mjs --check \
  --runtime=hybrid \
  --rollback-plan \
  --sha="${LAST_GOOD_SHA}" \
  --rust-bin=rust-shell/target/release/mso-shell-host \
  --assets=frontend/svelte/build \
  --api-origin=http://127.0.0.1:4005
```

Save the printed `lastKnownGoodSha` and `rollbackPlan` JSON in your operator log before changing
runtime configuration.

### 5.2 Switch runtime selection back to `next`

Unset `MSO_RUNTIME` or explicitly set `MSO_RUNTIME=next` in the service environment, then confirm
selector resolution:

```sh
node scripts/hybrid-runtime.mjs --check --runtime=next
```

Expected output fields:

- `"runtime": "next"`
- `"fallback": false`
- `"reason": "default_next"`

### 5.3 Preserve `~/.mso` untouched

Do **not** delete, recreate, or re-seed `~/.mso`. All existing session tokens, approved devices,
preferences, and encrypted credentials remain valid for the Next.js cockpit without conversion.

### 5.4 Stop `mso-shell-host` and verify the Next.js cockpit

Stop the opt-in `mso-shell-host` process (or revert the `mso.service` unit override to run
`scripts/server.mjs`), then verify the Next.js cockpit responds on its loopback port (for example
`127.0.0.1:3000`):

```sh
curl -fsS http://127.0.0.1:3000/api/auth/me
```

Confirm `/` loads the Next.js shell, `/api/auth/me` returns the expected auth JSON, and
`mso doctor` reports healthy runtime status (see [`INSTALL.md`](./INSTALL.md) and
[`DISASTER-RECOVERY.md`](./DISASTER-RECOVERY.md) if host recovery is needed).

### 5.5 Confirm `lastKnownGoodSha`

Verify the repository checkout matches the recorded `lastKnownGoodSha` and contains no unexpected
modifications:

```sh
git rev-parse HEAD
git status --short
```

Compare `git rev-parse HEAD` against the saved `lastKnownGoodSha`. If a checkout drifted on an
uncommitted tree, preserve local work before switching commits; never run destructive `git reset`
on a dirty checkout.

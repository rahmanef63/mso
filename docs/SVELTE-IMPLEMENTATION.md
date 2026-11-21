# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
and updated on **2026-11-22** after implementing **Increment 2B/3A + Rust Shell Stage R2B**.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in MSO-MIGRATION.md, not its
measurements.

## Overall progress snapshot (2026-11-22)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~39.6%** (Inc. 1 = 100%, Inc. 2 = 90%, Inc. 3 = 60% [3A landed], Inc. 4 = 3%, Inc. 5 = 0%).
- **Slice Parity Count:** **2 / 33 core slices ported** (`auth` core login/logout/session/owner-devices; `files-manager` read/browse/preview), plus **2 expanded foundations** (`appshell` window manager + `<svelte:boundary>` crash isolation + History URL sync; `system-monitor` stats + process inventory), **29 slices** not started, **0 / 5 OS chromes**, **0 / 10 AppShell features**.
- **Rust Shell Track:** **40.0%** (Stage R0 = 100%, Stage R2 = 100% [R2A + R2B complete], Stages R1/R3/R4 = 0%).
- **Combined Hybrid Program (60% Svelte + 40% Rust Shell):** **~39.8% (~40%)** (up from 22.4% after Inc. 2A/R2A and 12.0% after Stage R0).

## Goal and limits

The reported symptoms are heavy server RAM (~284 MiB idle RSS) and hydration-bound client
startup (~910 KiB first-load JS). The Svelte 5 static build is the shared frontend track for
both Web/PWA and a future Tauri v2 desktop app, paired incrementally with the Rust shell plan
in [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md). Keeping Next as the API backend does not
remove Next's RSS. No full-server resource improvement is claimed until measured on the same
host, workload, build mode and session count after cutover.

Production is still Next/React. The Svelte entry is not a React island, is not mounted on the
public cockpit origin, and does not change systemd, installers, state, tunnels or host policy.

## Integration milestones

| Increment | Weight | Deliverable and acceptance | State | Progress |
|---|---|---|---|---|
| 1 | 10% | Independently built static Svelte entry; existing session and one-shot metrics; cancellation, malformed/auth/error/retry tests; light/dark narrow/desktop browser proof | Merged on `main` (PR #285, 2026-11-09); audited 2026-11-21 with `perf:probe` readiness fix, `shell-bridge.ts`, and Stage R0 Rust host proof | **100%** |
| 2 | 15% | **2A:** Real login, pending-device guidance, logout, 128-bit device ID, Owner device approvals/role/inline-revoke, and CSRF depth-2 parity. **2B:** Managed-host split-origin routing, unclaimed namespace `404`, and OAuth/MCP/A2A machine-protocol passthrough (paired with Rust Shell Stage R2B). First-login onboarding sub-flow pending. | **2A & 2B edge implemented & verified locally; onboarding sub-flow pending** | **90%** |
| 3 | 25% | **3A (Implemented on branch):** Window lifecycle store, `<WindowFrame>` with `<svelte:boundary>` per-window crash isolation, History API URL sync, layout serialization, `files-manager` (`fs/list` + `fs/read` preview), and `system-monitor` process inventory (`sys/processes`). **3B (Remaining):** `os-terminal` (xterm + PTY streaming over WebSocket/SSE) and file write/mkdir mutations. | **3A implemented & verified locally; 3B not implemented** | **60%** |
| 4 | 35% | Full feature parity matrix below, five shells, settings, media/editors and sensitive workflows; contract tests plus browser journeys | `system-monitor` process inventory landed; remaining slices/chromes pending | **3%** |
| 5 | 15% | One runtime selected at launch; full API/proxy/streaming parity without Next (paired with Rust Shell Stage R3); exact-host RSS/CPU/latency comparison, supported installer/update path and rollback | Not implemented | **0%** |

Each increment uses a task branch and normal PR checks before main integration. Never force
push, bypass branch protection or call a draft shipped. A source push is not a deployment.
Deployment remains the supported owner release path after verified integration. Keep the
last known-good release and state format intact; rollback must not need data conversion.

## Increments 1, 2A/2B, and 3A: static entry, auth, windowing, files & processes

`frontend/svelte` has its own package and frozen Bun lockfile. Node runs the tools;
SvelteKit 3 with adapter-static emits `frontend/svelte/build`. There is no production SSR
process for this entry. `vite preview` is local test tooling, not the deployment server.
Root Next TypeScript/ESLint do not interpret the independently checked Svelte package.

From the repository root after installing root dependencies:

```sh
bun run svelte:install
bun run svelte:check
bun run svelte:build
bun run svelte:e2e
bun run svelte:audit
```

The browser test uses root Playwright and its Chromium install. All backend responses in
that test are synthetic and clearly scoped to the fixture. Production metrics come only
from the existing host endpoint; the UI has no fake-data mode and no polling loop.

For an explicitly local backend, start the preview from its package directory:

```sh
MSO_SVELTE_API_ORIGIN=http://127.0.0.1:4005 bun run preview
```

The port above is an example, not discovery of an installed service. Both the Vite dev/preview
proxy and the Rust Stage R2B host (`rust-shell/crates/mso-shell-host`) accept only explicit
loopback HTTP(S) origins, preserve the incoming `Host` and cookies, enforce **CSRF depth-2**
on mutating browser APIs, enforce bounded request bodies (`413`), forward multiple `Set-Cookie`
headers, and restrict routes to the reviewed allowlist. Rust Stage R2B additionally implements
managed-app split-origin host classification, CSRF-exempt OAuth/MCP/A2A machine-protocol
passthrough with `Authorization`, and bounded WebSocket upgrade tunneling (`ws.rs`).

Do not mount the generated HTML in production yet: `os-terminal`, remaining slices, appearance
preference syncing, and all five OS chromes remain gated on Increments 3B through 5.

## Feature parity ledger

The existing React product remains authoritative. No feature is silently dropped. Names
come from the current slice directory/catalog. "Not ported" is not a regression claim.

| Slice | Svelte state |
|---|---|
| agent-vault | Not ported |
| agent-group | Not ported |
| app-store | Not ported |
| appshell | **Increment 3A foundation:** window lifecycle store, `<WindowFrame>` with `<svelte:boundary>` crash isolation, History API URL sync, layout persistence; five OS chromes & 10 shell features not ported |
| assistant | Not ported |
| auth | **Core ported (Increment 2A):** session probe, password login, pending-device state, logout, 128-bit device ID, owner device approval/role/inline-revoke; first-login onboarding sub-flow pending |
| bot-desktops | Not ported |
| camoufox-browser | Not ported |
| channels | Not ported |
| code-editor | Not ported |
| create-app | Not ported |
| docs | Not ported |
| extensions | Not ported |
| files-manager | **Read/browse core ported (Increment 3A):** `fs/list` navigation, parent traversal, dirs-first sort, `fs/read` text preview; write/mkdir/upload/delete mutations pending (3B) |
| image-editor | Not ported |
| icon-picker | Not ported |
| image-picker | Not ported |
| infrastructure | Not ported |
| integrations | Not ported |
| managed-apps | Not ported (split-origin host routing ported in Rust Stage R2B) |
| n8n | Not ported |
| media-studio | Not ported |
| media-viewer | Not ported |
| memory-graph | Not ported |
| os-settings | Not ported |
| os-shell | Not ported |
| os-terminal | Not ported (Increment 3B target; Rust WS/term proxy routes ready in Stage R2B) |
| organization | Not ported |
| quicklinks | Not ported |
| reel-editor | Not ported |
| shell-settings | Not ported |
| system-monitor | **Stats + Process Inventory ported (Increment 1 + 3A):** one-shot CPU/RAM/Disk/Uptime + filterable/sortable `/api/v1/sys/processes`; services/logs/packages not ported |
| workflows | Not ported |

Shell features clipboard, control-center, desktop-icons, force-quit, inspector, lock-screen,
notifications, search, shortcut-help and widgets are all not ported. macOS, Windows, iOS,
Android and Dashboard chrome remain not ported. The entry preview is not a sixth shell.

## Measurement and final cutover gate

Record exact SHA, Node version, host memory/core count, supervisor and build mode. Compare
idle RSS/PSS, idle CPU, 1/4/8 terminal sessions, sustained terminal output, metrics subscribers,
file enumeration, event-loop delay and API/terminal p50/p95 latency. Separate MSO processes
from managed apps, browser services and shell children. Repeat idle/load runs and report
variance. Use the current cold-load/mobile perf scripts separately for frontend performance.

No production host or deployment was available to this implementation session. Existing
October benchmark numbers remain historical, not new measurements. Cutover requires full
feature/auth/transport/host-routing parity, no permission or CSP regression, root and Svelte
checks green, reviewed security evidence, and an explicit measured server-resource result.

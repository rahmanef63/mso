# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
and updated on **2026-11-22** after completing **Increment 3 (3A + 3B) + Rust SSE Streaming**.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in MSO-MIGRATION.md, not its
measurements.

## Overall progress snapshot (2026-11-22)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~50.6%** (Inc. 1 = 100%, Inc. 2 = 90%, **Inc. 3 = 100%**, Inc. 4 = 6%, Inc. 5 = 0%).
- **Slice Parity Count:** **4 / 33 slices** (`auth` core, `files-manager` read+write+mkdir+delete, `os-terminal` PTY+SSE, `system-monitor` stats+processes+services), plus **1 expanded shell foundation** (`appshell` window manager + `<svelte:boundary>` + URL sync), **28 slices** not started, **0 / 5 OS chromes**, **0 / 10 AppShell features**.
- **Rust Shell Track:** **43.0%** (Stage R0 = 100%, Stage R2 = 100%, Stage R3 = 15% [SSE streaming], Stages R1/R4 = 0%).
- **Combined Hybrid Program (60% Svelte + 40% Rust Shell):** **~47.6% (~48%)** (progression: 12.0% -> 22.4% -> 39.8% -> 47.6%).

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
| 1 | 10% | Independently built static Svelte entry; existing session and one-shot metrics; cancellation, malformed/auth/error/retry tests; light/dark narrow/desktop browser proof | Merged on `main` (PR #285, 2026-11-09); audited 2026-11-21 with `perf:probe` fix, `shell-bridge.ts`, and Stage R0 Rust host proof | **100%** |
| 2 | 15% | **2A:** Real login, pending-device guidance, logout, 128-bit device ID, Owner device approvals/role/inline-revoke, and CSRF depth-2 parity. **2B:** Managed-host split-origin routing, unclaimed namespace `404`, and OAuth/MCP/A2A passthrough (paired with Rust Stage R2B). First-login onboarding sub-flow pending. | **2A & 2B edge verified locally; onboarding sub-flow pending** | **90%** |
| 3 | 25% | **3A:** Window lifecycle store, `<WindowFrame>` with `<svelte:boundary>` per-window crash isolation, History API URL sync, layout serialization, `files-manager` read/browse, `system-monitor` processes. **3B:** `os-terminal` (PTY + live base64 SSE streaming), `files-manager` write/mkdir/delete mutations, and `system-monitor` Service Center (`GET/POST /api/v1/sys/services`). | **Complete & verified locally (56 unit tests + Chromium + live Rust SSE)** | **100%** |
| 4 | 35% | Full feature parity matrix below, five shells, settings, media/editors and sensitive workflows; contract tests plus browser journeys | `system-monitor` stats+processes+services landed; remaining 28 slices & 5 OS chromes pending | **6%** |
| 5 | 15% | One runtime selected at launch; full API/proxy/streaming parity without Next (paired with Rust Stage R3); exact-host RSS/CPU/latency comparison, supported installer/update path and rollback | Not implemented | **0%** |

Each increment uses a task branch and normal PR checks before main integration. Never force
push, bypass branch protection or call a draft shipped. A source push is not a deployment.
Deployment remains the supported owner release path after verified integration. Keep the
last known-good release and state format intact; rollback must not need data conversion.

## Increments 1-3: static entry, auth, windowing, files, terminal & monitor

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

Both the Vite dev/preview proxy and the Rust host (`rust-shell/crates/mso-shell-host`) accept
only explicit loopback HTTP(S) origins, preserve the incoming `Host` and cookies, enforce
**CSRF depth-2** on mutating browser APIs, enforce bounded request bodies (`413`), forward
multiple `Set-Cookie` headers, stream `/api/v1/term/stream` incrementally over SSE, and
restrict routes to the reviewed allowlist (keeping `/api/v1/exec/run` blocked at `404`).

Do not mount the generated HTML in production yet: remaining slices, appearance preference
syncing, and all five OS chromes remain gated on Increments 4 and 5.

## Feature parity ledger

The existing React product remains authoritative. No feature is silently dropped. Names
come from the current slice directory/catalog. "Not ported" is not a regression claim.

| Slice | Svelte state |
|---|---|
| agent-vault | Not ported |
| agent-group | Not ported |
| app-store | Not ported |
| appshell | **Increment 3 foundation:** window lifecycle store, `<WindowFrame>` with `<svelte:boundary>` crash isolation, History API URL sync, layout persistence; five OS chromes & 10 shell features not ported |
| assistant | Not ported |
| auth | **Core ported (Increment 2A):** session probe, password login, pending-device state, logout, 128-bit device ID, owner device approval/role/inline-revoke; first-login onboarding sub-flow pending |
| bot-desktops | Not ported |
| camoufox-browser | Not ported |
| channels | Not ported |
| code-editor | Not ported |
| create-app | Not ported |
| docs | Not ported |
| extensions | Not ported |
| files-manager | **Core + mutations ported (Increment 3A/3B):** `fs/list`, parent traversal, `fs/read` preview, `fs/write` inline edit/save, `fs/mkdir` inline folder creation, `fs/delete` inline two-step confirmation; upload/move/copy/zip pending |
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
| os-terminal | **Core PTY/SSE ported (Increment 3B):** `term/open`, live base64 UTF-8 SSE `term/stream`, ANSI sanitization, 64 KiB cap, `term/input`, `term/resize`, `term/close` on dispose |
| organization | Not ported |
| quicklinks | Not ported |
| reel-editor | Not ported |
| shell-settings | Not ported |
| system-monitor | **Stats + Processes + Service Center ported (Inc. 1, 3A, 3B):** CPU/RAM/Disk/Uptime, filterable/sortable `/api/v1/sys/processes`, allowlisted `GET/POST /api/v1/sys/services`; logs/packages pending |
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

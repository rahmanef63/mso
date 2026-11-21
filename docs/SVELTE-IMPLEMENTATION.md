# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
and updated on **2026-11-22** after completing **Increment 4A + Rust Stage R3B**.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in MSO-MIGRATION.md, not its
measurements.

## Overall progress snapshot (2026-11-22)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~56.2%** (Inc. 1 = 100%, Inc. 2 = 90%, Inc. 3 = 100%, **Inc. 4 = 22%**, Inc. 5 = 0%).
- **Slice Parity Count:** **8 / 33 slices** (`auth` core, `files-manager`, `os-terminal`, `system-monitor` 4/4 complete incl. read-only packages, `assistant` Alfa POST SSE, `os-settings` core, `quicklinks`, `managed-apps`), plus **1 expanded shell foundation** (`appshell` window manager + `<svelte:boundary>` + URL sync), **24 slices** not started, **0 / 5 OS chromes**, **0 / 10 AppShell features**.
- **Rust Shell Track:** **46.0%** (Stage R0 = 100%, Stage R2 = 100%, **Stage R3 = 30%** [GET+POST SSE + 23 routes], Stages R1/R4 = 0%).
- **Combined Hybrid Program (60% Svelte + 40% Rust Shell):** **~52.1% (~52%)** (progression: 12.0% -> 22.4% -> 39.8% -> 47.6% -> **52.1%**).

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
| 3 | 25% | **3A:** Window lifecycle store, `<WindowFrame>` with `<svelte:boundary>` per-window crash isolation, History API URL sync, layout serialization, `files-manager` read/browse, `system-monitor` processes. **3B:** `os-terminal` (PTY + live base64 SSE streaming), `files-manager` write/mkdir/delete mutations, and `system-monitor` Service Center (`GET/POST /api/v1/sys/services`). | **Complete & verified locally** | **100%** |
| 4 | 35% | Full feature parity matrix below, five shells, settings, media/editors and sensitive workflows; contract tests plus browser journeys | **4A landed:** `assistant` (Alfa POST SSE), `os-settings` + `quicklinks`, `managed-apps`, read-only `packages` (`system-monitor` 4/4); 24 slices, 5 OS chromes & 10 shell features pending | **22%** |
| 5 | 15% | One runtime selected at launch; full API/proxy/streaming parity without Next (paired with Rust Stage R3); exact-host RSS/CPU/latency comparison, supported installer/update path and rollback | Not implemented | **0%** |

Each increment uses a task branch and normal PR checks before main integration. Never force
push, bypass branch protection or call a draft shipped. A source push is not a deployment.
Deployment remains the supported owner release path after verified integration. Keep the
last known-good release and state format intact; rollback must not need data conversion.

## Increments 1-4A: static entry, auth, windowing, files, terminal, monitor, Alfa, settings & apps

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
multiple `Set-Cookie` headers, stream GET `/api/v1/term/stream` and POST `/api/assistant`
incrementally over SSE, and restrict routes to the reviewed 23-route allowlist (keeping
`/api/config` and `/api/v1/exec/run` blocked at `404`).

Do not mount the generated HTML in production yet: remaining slices, lazy window chunk loading,
and all five OS chromes remain gated on Increments 4B+ and 5.

## Feature parity ledger

The existing React product remains authoritative. No feature is silently dropped. Names
come from the current slice directory/catalog. "Not ported" is not a regression claim.

| Slice | Svelte state |
|---|---|
| agent-vault | Not ported |
| agent-group | Not ported |
| app-store | Not ported |
| appshell | **Increment 3 foundation:** window lifecycle store, `<WindowFrame>` with `<svelte:boundary>` crash isolation, History API URL sync, layout persistence; five OS chromes & 10 shell features not ported |
| assistant | **Core Alfa chat ported (Increment 4A):** `GET /api/models` selector, `POST /api/assistant` incremental SSE (`delta`, `text`, `reasoning`, `done`, `error`), IME-safe composer, Stop/Abort, Retry, New chat; thread persistence & tool cards pending |
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
| managed-apps | **Core list & status ported (Increment 4A + Rust R2B):** `GET /api/v1/managed-apps`, filter, install/health/version badges, safe `http(s)` dashboard links, plus split-origin host routing in Rust; install/update/backup/logs mutations pending |
| n8n | Not ported |
| media-studio | Not ported |
| media-viewer | Not ported |
| memory-graph | Not ported |
| os-settings | **Core preferences ported (Increment 4A):** `GET/POST /api/prefs` appearance theme (`system`/`light`/`dark`) and reduced-motion toggles with Owner-only edit guard; provider keys/update/account tabs pending |
| os-shell | Not ported |
| os-terminal | **Core PTY/SSE ported (Increment 3B):** `term/open`, live base64 UTF-8 SSE `term/stream`, ANSI sanitization, 64 KiB cap, `term/input`, `term/resize`, `term/close` on dispose |
| organization | Not ported |
| quicklinks | **Core ported (Increment 4A):** `/api/prefs` quicklinks list, safe `http://`/`https://` URL validation, Owner-only add and inline two-step remove |
| reel-editor | Not ported |
| shell-settings | Not ported |
| system-monitor | **Complete core (4/4, Inc. 1, 3A, 3B, 4A):** CPU/RAM/Disk/Uptime, filterable/sortable `/api/v1/sys/processes`, allowlisted `GET/POST /api/v1/sys/services`, and strictly read-only `/api/v1/sys/packages` cache visibility |
| workflows | Not ported |

Shell features clipboard, control-center, desktop-icons, force-quit, inspector, lock-screen,
notifications, search, shortcut-help and widgets are all not ported. macOS, Windows, iOS,
Android and Dashboard chrome remain not ported. The entry preview is not a sixth shell.

## Measurement and final cutover gate

Record exact SHA, Node version, host memory/core count, supervisor and build mode. Compare
idle RSS/PSS, idle CPU, 1/4/8 terminal sessions, sustained terminal output, metrics subscribers,
desktop and mobile 390px Slow 4G + 4x CPU cold/warm load, first-load JS, LCP, INP, CLS, and
long tasks before switching the default runtime.

Do not merge a cutover PR without rollback verification and real-device proof for desktop,
narrow mobile and iOS PWA standalone mode.

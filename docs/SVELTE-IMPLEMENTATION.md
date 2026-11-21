# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
and updated on **2026-11-22** after implementing **Increment 2A + Rust Shell Stage R2A**.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in MSO-MIGRATION.md, not its
measurements.

## Overall progress snapshot (2026-11-22)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~19%** (Increment 1 = 100%, Increment 2 = 60% [2A landed], Increments 3-5 = 0%).
- **Slice Parity Count:** **1 / 33 slices** (`auth` core login/logout/session/owner-devices ported; first-login onboarding sub-flow pending), plus **2 partial foundations** (`appshell` entry layout, `system-monitor` one-shot snapshot), **30 slices** not started, **0 / 5 OS chromes**, **0 / 10 AppShell features**.
- **Rust Shell Track:** **~27.5%** (Stage R0 = 100%, Stage R2 = 50% [R2A landed], Stages R1/R3/R4 = 0%).
- **Combined Hybrid Program (60% Svelte + 40% Rust Shell):** **~22%** (up from 12% after Stage R0).

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
| 2 | 15% | **2A (Implemented on branch):** Real login (`/api/auth/login`), pending-device guidance, logout (`/api/auth/logout`), stable 128-bit device ID (`mso.device.id` + `mso-device`), Owner device approvals/role updates/inline two-step revoke (`/api/auth/devices`), and CSRF depth-2 parity (paired with Rust Shell Stage R2A). **2B (Remaining):** Managed-host split-origin routing, public OAuth/MCP proxy parity, and first-login onboarding sub-flow. | **2A implemented & verified locally; 2B not implemented** | **60%** |
| 3 | 25% | Window lifecycle, registry, URL/deep links and persistence; Files and Terminal against existing host contracts; single-window failure isolation | Not implemented | **0%** |
| 4 | 35% | Full feature parity matrix below, five shells, settings, media/editors and sensitive workflows; contract tests plus browser journeys | Not implemented | **0%** |
| 5 | 15% | One runtime selected at launch; full API/proxy/streaming parity without Next (paired with Rust Shell Stage R3); exact-host RSS/CPU/latency comparison, supported installer/update path and rollback | Not implemented | **0%** |

Each increment uses a task branch and normal PR checks before main integration. Never force
push, bypass branch protection or call a draft shipped. A source push is not a deployment.
Deployment remains the supported owner release path after verified integration. Keep the
last known-good release and state format intact; rollback must not need data conversion.

## Increment 1 & 2A: static entry, auth, and owner device management

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
proxy and the Rust Stage R2A host (`rust-shell/crates/mso-shell-host`) accept only explicit
loopback HTTP(S) origins, preserve the incoming `Host` and cookies, enforce **CSRF depth-2**
(`Sec-Fetch-Site` / `Origin` / `session` cookie) on mutating API calls, enforce bounded request
bodies (413), forward multiple `Set-Cookie` headers, and allow only the exact Increment 2A
route table (`/api/auth/me`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/devices`,
`/api/v1/sys/stats`). All other `/api/*` paths fail closed to 404 JSON. Dev binds loopback port
5173, preview binds 4173, and `mso-shell-host` defaults to 4174.

Do not mount the generated HTML in production yet: managed-host split-origin routing, OAuth/MCP
passthrough, windowing, and remaining cockpit slices remain gated on Increments 2B through 5.
Both media-query themes here use reviewed neutral tokens; appearance preference syncing,
all five OS chromes and design-kit parity are not established by this preview.

## Feature parity ledger

The existing React product remains authoritative. No feature is silently dropped. Names
come from the current slice directory/catalog. "Not ported" is not a regression claim.

| Slice | Svelte state |
|---|---|
| agent-vault | Not ported |
| agent-group | Not ported |
| app-store | Not ported |
| appshell | Entry foundation only; window manager and five shells not ported |
| assistant | Not ported |
| auth | **Core ported (Increment 2A):** session probe, password login, pending-device state, logout, 128-bit device ID, owner device approval/role/inline-revoke; first-login onboarding sub-flow pending (2B) |
| bot-desktops | Not ported |
| camoufox-browser | Not ported |
| channels | Not ported |
| code-editor | Not ported |
| create-app | Not ported |
| docs | Not ported |
| extensions | Not ported |
| files-manager | Not ported |
| image-editor | Not ported |
| icon-picker | Not ported |
| image-picker | Not ported |
| infrastructure | Not ported |
| integrations | Not ported |
| managed-apps | Not ported |
| n8n | Not ported |
| media-studio | Not ported |
| media-viewer | Not ported |
| memory-graph | Not ported |
| os-settings | Not ported |
| os-shell | Not ported |
| os-terminal | Not ported |
| organization | Not ported |
| quicklinks | Not ported |
| reel-editor | Not ported |
| shell-settings | Not ported |
| system-monitor | Session-gated snapshot only; processes/services/logs/packages not ported |
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

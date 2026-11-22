# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, and expanded on
2026-11-21 to the **hybrid Svelte 5 static UI + Rust shell track** (see
[`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)). Deliver tested, reviewed increments to main;
do not wait for the full rewrite to integrate completed work. This supersedes the paused
product decision in MSO-MIGRATION.md, not its measurements.

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

| Increment | Deliverable and acceptance | State |
|---|---|---|
| 1 | Independently built static Svelte entry; existing session and one-shot metrics; cancellation, malformed/auth/error/retry tests; light/dark narrow/desktop browser proof | Merged on `main` (PR #285, 2026-11-09); audited 2026-11-21 with `perf:probe` readiness fix, `shell-bridge.ts` seam, and Stage R0 Rust static host proof |
| 2 | Framework-neutral session/login/device adapters and request context; live roles, cookie/CSRF/CSP contracts; no second login; managed-host and public OAuth/MCP parity (paired with Rust Shell Stage R2) | Not implemented |
| 3 | Window lifecycle, registry, URL/deep links and persistence; Files and Terminal against existing host contracts; single-window failure isolation | Not implemented |
| 4 | Full feature parity matrix below, five shells, settings, media/editors and sensitive workflows; contract tests plus browser journeys | Not implemented |
| 5 | One runtime selected at launch; full API/proxy/streaming parity without Next (paired with Rust Shell Stage R3); exact-host RSS/CPU/latency comparison, supported installer/update path and rollback | Not implemented |

Each increment uses a task branch and normal PR checks before main integration. Never force
push, bypass branch protection or call a draft shipped. A source push is not a deployment.
Deployment remains the supported owner release path after verified integration. Keep the
last known-good release and state format intact; rollback must not need data conversion.

## Increment 1: static entry

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

The port above is an example, not discovery of an installed service. The proxy accepts
only explicit loopback HTTP(S) origins, keeps the incoming Host, forwards only GET to
exact `/api/auth/me` and `/api/v1/sys/stats`, and leaves other endpoints unproxied. Dev
binds loopback port 5173; preview binds loopback port 4173, both strict. No remote origin,
credential forwarding to an arbitrary host, login clone, CORS widening or cookie-domain
change is added. A missing backend/HTML fallback is an unavailable state, not success.
Existing Secure, host-only cookie behavior still applies; a session on another hostname
is not automatically available to this preview. Real login integration remains increment 2.

Stage R0 (`rust-shell/crates/mso-shell-host`) also verifies serving `frontend/svelte/build`
directly from a zero-dependency loopback Rust binary with per-request CSP nonces injected into
the SvelteKit bootstrap script (`cd frontend/svelte && bun run test:rust-host`). Do not mount
the generated HTML in production yet: managed-host routing, login/device flows, and full
cockpit feature parity remain gated on Increments 2-5.
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
| auth | Existing session probe only; login/device management not ported |
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

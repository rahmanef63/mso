# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
and updated on **2026-11-22** after completing **Increment 4D + 10/10 AppShell Features + 5 OS Chromes + Rust Stage R3E/R4**.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in MSO-MIGRATION.md, not its
measurements.

## Overall progress snapshot (2026-11-22)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~75.8%** (Inc. 1 = 100%, Inc. 2 = 90%, Inc. 3 = 100%, **Inc. 4 = 78%**, Inc. 5 = 0%).
- **Slice Parity Count:** **27 / 33 slices** ported, **10 / 10 AppShell features COMPLETE**, **5 / 5 OS chromes** (`os-chrome.css` + `ShellSettingsApp`), **6 slices** remaining (`camoufox-browser`, `bot-desktops`, `n8n`, `image-editor`, `media-studio`, `reel-editor`).
- **Rust Shell Track:** **60.6%** (Stage R0 = 100%, Stage R1 = 15% [`desktop.rs`], Stage R2 = 100%, **Stage R3 = 65%** [49 routes + GET/POST SSE], **Stage R4 = 25%** [`sys_metrics.rs`]).
- **Combined Hybrid Program (60% Svelte + 40% Rust Shell):** **~69.7% (~70%)** (`12.0% -> 22.4% -> 39.8% -> 47.6% -> 52.1% -> 56.3% -> 62.2% -> 69.7%`).

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
| 1 | 10% | Independently built static Svelte entry; existing session and one-shot metrics; cancellation, malformed/auth/error/retry tests; light/dark narrow/desktop browser proof | Merged on `main` (PR #285, 2026-11-09); audited 2026-11-21 | **100%** |
| 2 | 15% | **2A:** Real login, pending-device guidance, logout, 128-bit device ID, Owner device approvals/role/inline-revoke, CSRF depth-2. **2B:** Managed-host split-origin routing, unclaimed `404`, OAuth/MCP/A2A passthrough. First-login onboarding pending. | **2A & 2B edge verified locally; onboarding pending** | **90%** |
| 3 | 25% | **3A:** Window store, `<WindowFrame>` + `<svelte:boundary>`, History URL sync, layout persistence, `files-manager` browse, `system-monitor` processes. **3B:** `os-terminal` (PTY + live SSE), `files-manager` mutations, Service Center. | **Complete & verified locally** | **100%** |
| 4 | 35% | Full feature parity matrix below, five shells, settings, media/editors and sensitive workflows; contract tests plus browser journeys | **4D landed:** **27/33 slices**, **10/10 AppShell features**, **5 OS chromes (`os-chrome.css`)**; final 6 heavy/canvas slices pending | **78%** |
| 5 | 15% | One runtime selected at launch; full API/proxy/streaming parity without Next (paired with Rust Stage R3); exact-host RSS/CPU/latency comparison, supported installer/update path and rollback | Not implemented | **0%** |

## Increments 1-4D: 27 slices, 10/10 AppShell features, 5 OS chromes & 49-route Rust host

`frontend/svelte` has its own package and frozen Bun lockfile. SvelteKit 3 with adapter-static
emits `frontend/svelte/build` with 27 lazy per-window chunks (`LazyWindowBody.svelte`).
Both the Vite dev/preview proxy and `rust-shell/crates/mso-shell-host` enforce explicit loopback
origins, CSRF depth-2, bounded bodies (`413`), multi `Set-Cookie`, GET+POST SSE, and the
reviewed **49-route allowlist** (keeping `/api/config`, `/api/v1/exec/run`, and
`/api/v1/editor/exec` blocked at `404`).

## Feature parity ledger

The existing React product remains authoritative. No feature is silently dropped. Names
come from the current slice directory/catalog. "Not ported" is not a regression claim.

| Slice | Svelte state |
|---|---|
| agent-vault | **Core ported (Increment 4D):** Owner-only `GET/POST /api/v1/agent-vault` project loader, Sync action, snapshot summary, plain-text note viewer |
| agent-group | **Core ported (Increment 4D):** Owner-only `GET/POST /api/v1/agent-groups` group cards, member badges, run prompt trigger & active run Stop |
| app-store | **Core ported (Increment 4C):** Owner-only `GET /api/v1/app-catalog` managed + connected catalog entries with status pill & filter |
| appshell | **Complete foundation (Inc. 3-4D):** window store, `<WindowFrame>` + `<svelte:boundary>`, `LazyWindowBody` (27 chunks), URL sync, layout persistence, **10/10 features** (`search`, `notifications`, `shortcut-help`, `clipboard`, `control-center`, `force-quit`, `lock-screen`, `inspector`, `desktop-icons`, `widgets`) |
| assistant | **Core Alfa chat ported (Increment 4A):** `GET /api/models`, `POST /api/assistant` incremental SSE, IME-safe composer, Stop/Retry/New chat |
| auth | **Core ported (Increment 2A):** session probe, password login, pending-device state, logout, 128-bit device ID, owner device approval/role/inline-revoke |
| bot-desktops | Not ported (Rust R3E routes `/api/v1/desktop/{containers,lifecycle}` ready) |
| camoufox-browser | Not ported (Rust R3E routes `/api/v1/camoufox/{service,session}` ready) |
| channels | **Core ported (Increment 4B):** Owner-only `GET /api/v1/channels` inventory + non-destructive `POST` connectivity Test |
| code-editor | **Core ported (Increment 4B):** `fs/read` + `fs/write`, language & buffer stats, scroll-synced gutter, `Ctrl/Cmd+S`, Revert, dirty close guard |
| create-app | **Core ported (Increment 4D):** Owner-only `GET/POST /api/v1/shell-apps` registry view, inline 2-step Remove, and schema-v1 Create form |
| docs | **Core ported (Increment 4B):** safe structured `GET /api/changelog` parser (zero `{@html}`) + filter + Quick Reference tab |
| extensions | **Core ported (Increment 4C):** Modular Features (`GET /api/v1/features`) + Owner-only Skills & Recipes (`GET /api/skills`) with trust badges |
| files-manager | **Core + mutations ported (Increment 3A/3B):** `fs/list`, parent traversal, `fs/read`, `fs/write`, `fs/mkdir`, `fs/delete` inline 2-step confirm |
| image-editor | Not ported |
| icon-picker | **Core ported (Increment 4D):** searchable 24-icon curated catalog + click-to-copy ID inside `PickersApp.svelte` |
| image-picker | **Core ported (Increment 4D):** live `GET /api/v1/stock/search` image grid with `http(s)` URL filter, attribution & copy inside `PickersApp.svelte` |
| infrastructure | **Core ported (Increment 4C):** Owner-only `GET /api/v1/infra/providers`, single `convex` provider canonicalization, zero secret rendering |
| integrations | **Core ported (Increment 4B):** Owner-only `GET /api/v1/integrations`, single `convex` provider canonicalization, zero secret rendering |
| managed-apps | **Core list & status ported (Increment 4A + Rust R2B):** `GET /api/v1/managed-apps` status/health/version/dashboard links + split-origin routing |
| n8n | Not ported |
| media-studio | Not ported |
| media-viewer | **Core ported (Increment 4D):** `/api/v1/fs/raw` viewer for image/audio/video + text/unsupported fallback |
| memory-graph | **Core ported (Increment 4C):** Owner-only `GET /api/v1/memory-graph` counts, kind filter, search, neighbor edges, and Open-in-Code-Editor handoff |
| os-settings | **Core preferences ported (Increment 4A):** `GET/POST /api/prefs` appearance theme & reduced-motion with Owner-only edit guard |
| os-shell | **5 OS Chromes ported (Increment 4D):** distinct responsive `macos`, `windows`, `dashboard`, `ios`, `android` chrome layouts in `os-chrome.css` + `chrome-profile.ts` |
| os-terminal | **Core PTY/SSE ported (Increment 3B):** `term/open`, live base64 UTF-8 SSE `term/stream`, ANSI sanitization, 64 KiB cap, input/resize/close |
| organization | **Core ported (Increment 4C):** `GET /api/v1/organization` Units/Seats hierarchy, search, runtime status & target kind badges |
| quicklinks | **Core ported (Increment 4A):** `/api/prefs` quicklinks list, safe `http(s)` validation, Owner-only add and inline two-step remove |
| reel-editor | Not ported |
| shell-settings | **Core ported (Increment 4D):** `ShellSettingsApp.svelte` via `/api/prefs` for chrome profile, theme, font scale (90-120%), reduce-glass, high-contrast & reduced-motion |
| system-monitor | **Complete core (4/4, Inc. 1, 3A, 3B, 4A):** CPU/RAM/Disk/Uptime, `/api/v1/sys/processes`, allowlisted `/api/v1/sys/services`, read-only `/api/v1/sys/packages` |
| workflows | **Core ported (Increment 4B):** `GET /api/v1/workflows` filterable graph list + `?runs=1` Recent Runs tab |

All **10 / 10 AppShell features** (`search`, `notifications`, `shortcut-help`, `clipboard`,
`control-center`, `force-quit`, `lock-screen`, `inspector`, `desktop-icons`, `widgets`) and all
**5 / 5 OS chrome profiles** (`macos`, `windows`, `dashboard`, `ios`, `android`) are now ported.

## Measurement and final cutover gate

Record exact SHA, Node version, host memory/core count, supervisor and build mode. Compare
idle RSS/PSS, idle CPU, 1/4/8 terminal sessions, sustained terminal output, metrics subscribers,
desktop and mobile 390px Slow 4G + 4x CPU cold/warm load, first-load JS, LCP, INP, CLS, and
long tasks before switching the default runtime.

Do not merge a cutover PR without rollback verification and real-device proof for desktop,
narrow mobile and iOS PWA standalone mode.

# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
and updated on **2026-11-22** after completing **Increments 1-4 (100%) + Increment 5 Cutover Drill, Benchmark, iOS PWA & Runbook (60%) + Rust Stage R4 (100%)**.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in MSO-MIGRATION.md, not its
measurements.

## Overall progress snapshot (2026-11-22)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~94.0%** (**Inc. 1 = 100%**, **Inc. 2 = 100%**, **Inc. 3 = 100%**, **Inc. 4 = 100%**, **Inc. 5 = 60%**).
- **Slice Parity Count:** **33 / 33 slices COMPLETE**, **10 / 10 AppShell features COMPLETE**, **5 / 5 OS chromes COMPLETE**, Files Search/Copy/Move UI, Workflows SVG topology, 4-tab Settings (Prefs, Account/Onboarding, Updates, Audit), 33 lazy window chunks + `LazyModals`, iOS PWA standalone manifest & safe-area insets.
- **Rust Shell Track:** **84.5%** (**R0 = 100%**, **R1 = 50%** [scaffold + `profiles.rs` + CI blueprint + contract tests], **R2 = 100%**, **R3 = 85%** [62 route policies + `/healthz` + SSE + WS + automated cutover drill], **R4 = 100% COMPLETE** [live `--native-metrics` `stats`+`processes` + `--native-fs-root` `list`/`read`/`search`/`usage`]).
- **Combined Hybrid Program (60% Svelte + 40% Rust Shell):** **~90.2% (~90%)** (`12.0% -> 22.4% -> 39.8% -> 47.6% -> 52.1% -> 56.3% -> 62.2% -> 69.7% -> 74.9% -> 80.9% -> 87.8% -> 90.2%`).

## Goal and limits

The reported symptoms are heavy server RAM (~284 MiB idle RSS) and hydration-bound client
startup (~910 KiB first-load JS). The Svelte 5 static build is the shared frontend track for
both Web/PWA and `rust-shell/desktop-tauri/`, paired incrementally with the Rust shell plan
in [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md). Production remains Next/React until live
`mso.service` cutover & real-device proof.

## Integration milestones

| Increment | Weight | Deliverable and acceptance | State | Progress |
|---|---|---|---|---|
| 1 | 10% | Independently built static Svelte entry; existing session and one-shot metrics; cancellation, malformed/auth/error/retry tests; light/dark narrow/desktop browser proof | Merged on `main` (PR #285, 2026-11-09); audited 2026-11-21 | **100%** |
| 2 | 15% | Real login, pending-device guidance, logout, 128-bit device ID, Owner device approvals/role/inline-revoke, CSRF depth-2, split-origin/MCP edge, plus first-login onboarding, `/api/auth/account` & `/api/auth/password` rotation | **Complete & verified locally (100%)** | **100%** |
| 3 | 25% | Window store, `<WindowFrame>` + `<svelte:boundary>`, History URL sync, layout persistence, `files-manager`, `os-terminal` (PTY + live SSE), Service Center | **Complete & verified locally (100%)** | **100%** |
| 4 | 35% | All 33 slices, 5 OS chromes, 10 AppShell features, Files Search/Copy/Move UI, Workflows SVG topology, 4-tab Settings (Prefs/Account/Updates/Audit), `LazyModals`, contract tests & Chromium journeys | **Complete & verified locally (100%)** | **100%** |
| 5 | 15% | Fail-safe runtime selector (`scripts/hybrid-runtime.mjs`) + automated cutover/rollback drill (`scripts/cutover-drill.mjs` with SHA-256 `~/.mso` immutability) + same-host benchmark (`scripts/bench-hybrid-same-host.mjs`) + iOS PWA standalone manifest/safe-area + operator [`CUTOVER-RUNBOOK.md`](./CUTOVER-RUNBOOK.md) landed; live `mso.service` switch & real-device iPhone proof pending | **Cutover drill, benchmark, iOS PWA & runbook verified (60%); live prod cutover pending** | **60%** |

## Increments 1-5: 33/33 slices, 10/10 features, 5 chromes, runtime selector & live Rust Stage R4

`frontend/svelte` has its own package and frozen Bun lockfile. SvelteKit 3 with adapter-static
emits `frontend/svelte/build` with 33 lazy per-window chunks (`LazyWindowBody.svelte`) and 5
on-demand shell modal chunks (`LazyModals.svelte`). `rust-shell/crates/mso-shell-host` enforces
explicit loopback origins, CSRF depth-2, bounded bodies (`413`), multi `Set-Cookie`, GET+POST SSE,
`/healthz`, 62 route policies (keeping `/api/config`, `/api/v1/exec/run`, and
`/api/v1/editor/exec` blocked at `404`), and opt-in Stage R4 native endpoints (`--native-metrics`,
`--native-fs-root` serving `list`/`read`/`search` without Node).

## Feature parity ledger (33 / 33 complete)

The existing React product remains authoritative until live production cutover.

| Slice | Svelte state |
|---|---|
| agent-vault | **Complete (Inc. 4D):** Owner-only `GET/POST /api/v1/agent-vault` loader, Sync, snapshot summary, plain-text note viewer |
| agent-group | **Complete (Inc. 4D):** Owner-only `GET/POST /api/v1/agent-groups` group cards, members, run prompt & active run Stop |
| app-store | **Complete (Inc. 4C):** Owner-only `GET /api/v1/app-catalog` managed + connected catalog entries with status pill & filter |
| appshell | **Complete (Inc. 3-4E):** window store, `<WindowFrame>` + `<svelte:boundary>`, `LazyWindowBody` (33 chunks), `LazyModals`, URL sync, layout persistence, **10/10 features** |
| assistant | **Complete (Inc. 4A):** `GET /api/models`, `POST /api/assistant` incremental SSE, IME-safe composer, Stop/Retry/New chat |
| auth | **Complete (Inc. 2A+2B):** session probe, password login, pending-device state, logout, 128-bit device ID, owner device approval/role/inline-revoke, first-login onboarding, `/api/auth/account` & `/api/auth/password` rotation |
| bot-desktops | **Complete (Inc. 4E):** `GET /api/v1/desktop/containers`, screenshot preview (`/api/v1/desktop/screenshot`), Logs viewer, Start + inline 2-step Stop/Restart |
| camoufox-browser | **Complete (Inc. 4E):** `GET/POST /api/v1/camoufox/service`, Start + 2-step Stop, `GET /api/v1/camoufox/session` with masked credentials & safe viewer link |
| channels | **Complete (Inc. 4B):** Owner-only `GET /api/v1/channels` inventory + non-destructive `POST` connectivity Test |
| code-editor | **Complete (Inc. 4B):** `fs/read` + `fs/write`, language & buffer stats, scroll-synced gutter, `Ctrl/Cmd+S`, Revert, dirty close guard |
| create-app | **Complete (Inc. 4D):** Owner-only `GET/POST /api/v1/shell-apps` registry, inline 2-step Remove, schema-v1 Create form |
| docs | **Complete (Inc. 4B):** safe structured `GET /api/changelog` parser (zero `{@html}`) + filter + Quick Reference tab |
| extensions | **Complete (Inc. 4C):** Modular Features (`GET /api/v1/features`) + Owner-only Skills & Recipes (`GET /api/skills`) with trust badges |
| files-manager | **Complete (Inc. 3A/3B/4F/Wave 9):** `fs/list`, parent traversal, `fs/read`, `fs/write`, `fs/mkdir`, `fs/delete` 2-step confirm, plus interactive `FilesOpsPanel` Search/Copy/Move UI (compatible with Rust `--native-fs-root`) |
| image-editor | **Complete (Inc. 4E):** `/api/v1/fs/raw` loader, Brightness/Contrast/Saturation sliders, Rotate 90, Flip H/V, Reset, Canvas PNG & JSON export |
| icon-picker | **Complete (Inc. 4D):** searchable 24-icon curated catalog + click-to-copy ID inside `PickersApp.svelte` |
| image-picker | **Complete (Inc. 4D):** live `GET /api/v1/stock/search` image grid with `http(s)` URL filter, attribution & copy inside `PickersApp.svelte` |
| infrastructure | **Complete (Inc. 4C):** Owner-only `GET /api/v1/infra/providers`, single `convex` provider canonicalization, zero secret rendering |
| integrations | **Complete (Inc. 4B):** Owner-only `GET /api/v1/integrations`, single `convex` provider canonicalization, zero secret rendering |
| managed-apps | **Complete (Inc. 4A + Rust R2B):** `GET /api/v1/managed-apps` status/health/version/dashboard links + split-origin routing |
| n8n | **Complete (Inc. 4E):** live `n8n` managed-app health/version/diagnostic bridge + safe dashboard link & install guidance |
| media-studio | **Complete (Inc. 4E):** multi-asset media project workspace (`/api/v1/fs/raw`), reorder/remove clips, live preview & duration total |
| media-viewer | **Complete (Inc. 4D):** `/api/v1/fs/raw` viewer for image/audio/video + text/unsupported fallback |
| memory-graph | **Complete (Inc. 4C):** Owner-only `GET /api/v1/memory-graph` counts, kind filter, search, neighbor edges, Open-in-Code-Editor handoff |
| os-settings | **Complete (Inc. 4A+4F):** 4-tab Settings (`Preferences`, `Account` onboarding/password, single in-Settings `Updates`, Owner-only `Audit Log`) |
| os-shell | **Complete (Inc. 4D):** distinct responsive `macos`, `windows`, `dashboard`, `ios`, `android` chrome layouts in `os-chrome.css` + `chrome-profile.ts` |
| os-terminal | **Complete (Inc. 3B):** `term/open`, live base64 UTF-8 SSE `term/stream`, ANSI sanitization, 64 KiB cap, input/resize/close |
| organization | **Complete (Inc. 4C):** `GET /api/v1/organization` Units/Seats hierarchy, search, runtime status & target kind badges |
| quicklinks | **Complete (Inc. 4A):** `/api/prefs` quicklinks list, safe `http(s)` validation, Owner-only add and inline two-step remove |
| reel-editor | **Complete (Inc. 4E):** vertical 9:16 preview frame, caption overlay, clip timeline add/reorder/remove, scrub slider & `MM:SS` timecode |
| shell-settings | **Complete (Inc. 4D):** `ShellSettingsApp.svelte` via `/api/prefs` for chrome profile, theme, font scale (90-120%), reduce-glass, high-contrast & reduced-motion |
| system-monitor | **Complete (4/4, Inc. 1-4A + Rust R4):** CPU/RAM/Disk/Uptime (compatible with Rust `--native-metrics`), `/api/v1/sys/processes`, `/api/v1/sys/services`, read-only `/api/v1/sys/packages` |
| workflows | **Complete (Inc. 4B + Wave 9):** `GET /api/v1/workflows` filterable graph list + `?runs=1` Recent Runs tab + interactive SVG topology `WorkflowGraphCanvas` |

## Measurement and final cutover gate

`scripts/hybrid-runtime.mjs` selects between `next` (default) and `hybrid` with automatic
fail-safe fallback and zero state conversion. `scripts/bench-hybrid-same-host.mjs` captures
exact SHA, Node version, CPU/RAM, Rust startup (2.75 ms), idle/active RSS (2.6/2.8 MiB),
HTML+CSP TTFB (0.455 ms p50), and native `fs_jail` search (0.480 ms p50).

Do not switch `mso.service` in production without live-host rollback verification and
real-device proof for desktop, narrow mobile, and iOS PWA standalone mode.

# Svelte implementation and cutover plan

Status: implementation restarted on 2026-11-09 at the owner's request, expanded on 2026-11-21 to
the **hybrid Svelte 5 static UI + Rust shell track** (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md)),
completed full Next.js removal on **2026-11-23**, and updated on **2026-11-24** with OS shell
restoration, `public/` asset packaging SSOT, build SHA/mode identity, and offline mock demo mode.
Deliver tested, reviewed increments to main; do not wait for the full rewrite to integrate
completed work. This supersedes the paused product decision in `MSO-MIGRATION.md`, not its
measurements.

## Overall progress snapshot (2026-11-24)

Formula-based milestone progress (see [`RUST-SHELL-PLAN.md`](./RUST-SHELL-PLAN.md) for full weights):

- **Svelte Static Frontend Track:** **~96.0%** (**Inc. 1-4 = 100%**, Next.js removed 2026-11-23, **Inc. 5 = 70%** with asset SSOT, build identity, 5-shell Settings/Files restoration, and offline demo mode).
- **Slice Parity Count:** **33 / 33 app IDs** in `frontend/svelte/src/lib/shell/shell-registry.ts` and `LazyWindowBody.svelte`, **23 Svelte feature modules** (`22` core + `1` `demo` support module) in `frontend/svelte/src/lib/feature-contracts.ts`, **5 / 5 OS chromes** (`macos`, `windows`, `dashboard`, `ios`, `android`), 5 on-demand `LazyModals`, and iOS PWA standalone manifest/safe-area insets.
- **Rust Shell Track:** **84.5%** (**R0 = 100%**, **R1 = 50%**, **R2 = 100%**, **R3 = 85%** [62 route policies + `/healthz` + SSE + WS + automated cutover drill], **R4 = 100%** [live `--native-metrics` + `--native-fs-root`]).
- **Backend HTTP Runtime:** zero-Next Web Fetch router (`scripts/server.mjs` + `lib/http/router.ts`) serving all `app/**/route.ts` API/MCP/OAuth/A2A handlers and `frontend/svelte/build`.

## Asset packaging SSOT (`public/` -> `frontend/svelte/build/`)

`public/` at repository root is the single source of truth for static wallpapers, app icons,
branding, demo media, and PWA icons. Packaging is owned by
`frontend/svelte/tooling/public-assets.mjs` and wired into `frontend/svelte/vite.config.js`:

- **Packaged entries (`PUBLIC_ASSET_ENTRIES`):** `wallpapers`, `app-icons`, `brand`,
  `demo-media`, `icon.svg`, and `icon-maskable.svg`.
- **Dev server (`vite dev`):** `msoPublicAssetsPlugin.configureServer` serves matching files
  directly from `public/` while bypassing reserved backend prefixes (`/api`, `/_next`, `/mcp`,
  `/oauth`, `/.well-known`, `/a2a`).
- **Static build (`vite build`):** `createMsoStaticAdapter` and `closeBundle` invoke
  `syncPublicAssets(PUBLIC_DIR, BUILD_DIR, meta)` so every build outputs a self-contained
  `frontend/svelte/build/` tree with all public assets and `build-meta.json`.
- **Preview server (`vite preview`):** `msoPublicAssetsPlugin.configurePreviewServer` serves
  files from `frontend/svelte/build/`, returns strict `404 text/plain` for missing extensioned
  assets (preventing HTML MIME fallback for missing `.webp`/`.js` files), and falls back
  extensionless deep-link paths (e.g. `/settings`, `/files`) to `index.html`.

## Build SHA and mode identity

Every Svelte build stamps verifiable build identity in two places (`frontend/svelte/vite.config.js`
and `frontend/svelte/tooling/public-assets.mjs`):

1. **Compile-time globals (`frontend/svelte/src/app.d.ts`):**
   - `__MSO_BUILD_SHA__`: resolved in order from `MSO_BUILD_SHA`, `VERCEL_GIT_COMMIT_SHA`,
     `GITHUB_SHA`, `git rev-parse --short=12 HEAD`, or `"dev"`.
   - `__MSO_BUILD_MODE__`: `"demo"` when `MSO_DEMO_MODE=1`, otherwise Vite's `mode`
     (`"development"` or `"production"`).
2. **Build manifest (`frontend/svelte/build/build-meta.json`):** JSON record `{ sha, mode, builtAt, assets }` listing the exact SHA, mode, ISO timestamp, and sorted asset inventory copied from `public/`.

## Workflows: offline mock demo vs Svelte + Rust/Node integration

Keep offline UI preview and live backend integration strictly separate:

### 1. Offline mock demo workflow (zero VPS, zero login, zero network)

Run one command from the repository root:

```bash
cd frontend/svelte && MSO_DEMO_MODE=1 bun run build && bun run preview
```

Or append `?demo=1` (or `?demo=true`) to any served Svelte UI URL. When demo mode is active:

- `frontend/svelte/src/lib/demo/demo-adapter.ts` (`isDemoMode`, `createDemoFetch`,
  `installDemoFetch`, `uninstallDemoFetch`) intercepts all `/api/*` requests purely in memory
  with zero calls reaching the network or host backend.
- Includes a mutable in-memory virtual filesystem rooted at `/home/demo` (`list`, `read`,
  `write`, `mkdir`, `delete`, `copy`, `move`, `search`, `usage`), session-only `/api/prefs`,
  synthetic auth (`demo-visitor`, role `owner`), synthetic monitor stats/processes/services,
  workflows, and clean fixtures for all 33 apps.
- `frontend/svelte/src/lib/demo/DemoBanner.svelte` renders a high-contrast banner showing
  `Demo mode · Offline synthetic data · Build <sha>` plus an independent viewport preview
  size selector (`Desktop 1440px`, `Tablet 820px`, `Phone 390px`) separate from the OS shell
  selector.

### 2. Svelte + Rust/Node live integration workflow

Run the backend host (Node zero-Next server or Rust hybrid shell) and attach the Vite proxy
against loopback only (`frontend/svelte/tooling/backend-proxy.mjs`, mirroring the 58-route
allowlist and CSRF depth-2 checks):

```bash
# Terminal 1: start live MSO backend on 127.0.0.1:3000 (Node server or Rust hybrid runtime)
bun run start
# (or: MSO_RUNTIME=hybrid node scripts/hybrid-runtime.mjs)

# Terminal 2: run Svelte dev server proxying /api/* to the local backend
cd frontend/svelte && MSO_SVELTE_API_ORIGIN=http://127.0.0.1:3000 bun run dev
```

For production static serving without Vite, build once (`bun run svelte:build`) and run
`bun run start` (Node server) or `MSO_RUNTIME=hybrid node scripts/hybrid-runtime.mjs` (Rust
`mso-shell-host` serving `frontend/svelte/build` plus proxying/handling `/api/*`).

## Integration milestones

| Increment | Weight | Deliverable and acceptance | State | Progress |
|---|---|---|---|---|
| 1 | 10% | Independently built static Svelte entry; existing session and one-shot metrics; cancellation, malformed/auth/error/retry tests; light/dark narrow/desktop browser proof | Merged on `main` (PR #285, 2026-11-09); audited 2026-11-21 | **100%** |
| 2 | 15% | Real login, pending-device guidance, logout, 128-bit device ID, Owner device approvals/role/inline-revoke, CSRF depth-2, split-origin/MCP edge, plus first-login onboarding, `/api/auth/account` & `/api/auth/password` rotation | **Complete & verified locally (100%)** | **100%** |
| 3 | 25% | Window store, `<WindowFrame>` + `<svelte:boundary>`, History URL sync, layout persistence, `files-manager`, `os-terminal` (PTY + live SSE), Service Center | **Complete & verified locally (100%)** | **100%** |
| 4 | 35% | All 33 app slices, 5 OS chromes, 10 AppShell features, Files Search/Copy/Move UI, Workflows SVG topology, 4-tab Settings (Prefs/Account/Updates/Audit), `LazyModals`, contract tests & Chromium journeys | **Complete & verified locally (100%)** | **100%** |
| 5 | 15% | Full Next.js removal (2026-11-23), fail-safe runtime selector (`scripts/hybrid-runtime.mjs`), automated cutover/rollback drill (`scripts/cutover-drill.mjs`), same-host benchmark (`scripts/bench-hybrid-same-host.mjs`), iOS PWA standalone manifest/safe-area, `public/` asset SSOT, build SHA/mode identity, offline demo mode, and [`CUTOVER-RUNBOOK.md`](./CUTOVER-RUNBOOK.md); live `mso.service` switch & real-device iPhone proof pending | **In progress (70%); live prod cutover & real-device iPhone proof pending** | **70%** |

## Feature parity ledger (33 / 33 app IDs + demo support module)

| App / Slice | Svelte state |
|---|---|
| agent-vault | **Complete (Inc. 4D):** Owner-only `GET/POST /api/v1/agent-vault` loader, Sync, snapshot summary, plain-text note viewer |
| agent-group | **Complete (Inc. 4D):** Owner-only `GET/POST /api/v1/agent-groups` group cards, members, run prompt & active run Stop |
| app-store (`store`) | **Complete (Inc. 4C):** Owner-only `GET /api/v1/app-catalog` managed + connected catalog entries with status pill & filter |
| appshell (`shell`) | **Complete (Inc. 3-5):** window store, `<WindowFrame>` + `<svelte:boundary>`, `LazyWindowBody` (33 chunks), `LazyModals` (5 chunks), URL sync, independent desktop/mobile shell prefs, 5 OS chromes |
| assistant | **Complete (Inc. 4A):** `GET /api/models`, `POST /api/assistant` incremental SSE, IME-safe composer, Stop/Retry/New chat |
| auth | **Complete (Inc. 2A+2B):** session probe, password login, pending-device state, logout, 128-bit device ID, owner device approval/role/inline-revoke, first-login onboarding, `/api/auth/account` & `/api/auth/password` rotation |
| bot-desktops | **Complete (Inc. 4E):** `GET /api/v1/desktop/containers`, screenshot preview (`/api/v1/desktop/screenshot`), Logs viewer, Start + inline 2-step Stop/Restart |
| camoufox-browser (`camoufox`) | **Complete (Inc. 4E):** `GET/POST /api/v1/camoufox/service`, Start + 2-step Stop, `GET /api/v1/camoufox/session` with masked credentials & safe viewer link |
| channels | **Complete (Inc. 4B):** Owner-only `GET /api/v1/channels` inventory + non-destructive `POST` connectivity Test |
| code-editor (`editor`) | **Complete (Inc. 4B):** `fs/read` + `fs/write`, language & buffer stats, scroll-synced gutter, `Ctrl/Cmd+S`, Revert, dirty close guard |
| create-app | **Complete (Inc. 4D):** Owner-only `GET/POST /api/v1/shell-apps` registry, inline 2-step Remove, schema-v1 Create form |
| demo (`demo` support) | **Complete (2026-11-24):** Offline synthetic `/api/*` fetch adapter (`demo-adapter.ts`), in-memory virtual FS, session-only `/api/prefs`, and `DemoBanner.svelte` viewport preview switcher |
| docs | **Complete (Inc. 4B):** safe structured `GET /api/changelog` parser (zero `{@html}`) + filter + Quick Reference tab |
| extensions | **Complete (Inc. 4C):** Modular Features (`GET /api/v1/features`) + Owner-only Skills & Recipes (`GET /api/skills`) with trust badges |
| files-manager (`files`) | **Complete (Inc. 3-5):** `fs/list`, parent traversal, `fs/read`, `fs/write`, `fs/mkdir`, `fs/delete` 2-step confirm, `FilesOpsPanel` Search/Copy/Move UI, and 5-shell presentations (`finder`, `explorer`, `ios-files`, `android-files`, `dashboard`) |
| image-editor | **Complete (Inc. 4E):** `/api/v1/fs/raw` loader, Brightness/Contrast/Saturation sliders, Rotate 90, Flip H/V, Reset, Canvas PNG & JSON export |
| pickers (icon + image) | **Complete (Inc. 4D):** searchable 24-icon curated catalog + live `GET /api/v1/stock/search` image grid inside `PickersApp.svelte` |
| infrastructure (`infra`) | **Complete (Inc. 4C):** Owner-only `GET /api/v1/infra/providers`, single `convex` provider canonicalization, zero secret rendering |
| integrations | **Complete (Inc. 4B):** Owner-only `GET /api/v1/integrations`, single `convex` provider canonicalization, zero secret rendering |
| managed-apps (`apps`) | **Complete (Inc. 4A + Rust R2B):** `GET /api/v1/managed-apps` status/health/version/dashboard links + split-origin routing |
| n8n | **Complete (Inc. 4E):** live `n8n` managed-app health/version/diagnostic bridge + safe dashboard link & install guidance |
| media-studio | **Complete (Inc. 4E):** multi-asset media project workspace (`/api/v1/fs/raw`), reorder/remove clips, live preview & duration total |
| media-viewer (`media`) | **Complete (Inc. 4D):** `/api/v1/fs/raw` viewer for image/audio/video + text/unsupported fallback |
| memory-graph (`memory`) | **Complete (Inc. 4C):** Owner-only `GET /api/v1/memory-graph` counts, kind filter, search, neighbor edges, Open-in-Code-Editor handoff |
| os-settings (`settings`) | **Complete (Inc. 4-5):** 4-tab Settings (`Preferences`, `Account`, single in-Settings `Updates`, Owner-only `Audit Log`) with 5-shell navigation modes (`macos-sidebar`, `windows-rail`, `ios-stack`, `android-list`, `dashboard-tabs`) |
| os-shell (`shell`) | **Complete (Inc. 4-5):** distinct responsive `macos`, `windows`, `dashboard`, `ios`, `android` chrome layouts in `os-chrome.css` + `chrome-profile.ts` + `shell-design.ts` |
| os-terminal (`terminal`) | **Complete (Inc. 3B):** `term/open`, live base64 UTF-8 SSE `term/stream`, ANSI sanitization, 64 KiB cap, input/resize/close |
| organization | **Complete (Inc. 4C):** `GET /api/v1/organization` Units/Seats hierarchy, search, runtime status & target kind badges |
| quicklinks | **Complete (Inc. 4A):** `/api/prefs` quicklinks list, safe `http(s)` validation, Owner-only add and inline two-step remove |
| reel-editor | **Complete (Inc. 4E):** vertical 9:16 preview frame, caption overlay, clip timeline add/reorder/remove, scrub slider & `MM:SS` timecode |
| shell-settings | **Complete (Inc. 4D-5):** `ShellSettingsApp.svelte` via `/api/prefs` for independent desktop/mobile shells, theme, wallpaper, font scale, reduce-glass, high-contrast, and reduced-motion |
| system-monitor (`processes`, `services`, `packages`) | **Complete (Inc. 1-4A + Rust R4):** CPU/RAM/Disk/Uptime (compatible with Rust `--native-metrics`), `/api/v1/sys/processes`, `/api/v1/sys/services`, read-only `/api/v1/sys/packages` |
| workflows | **Complete (Inc. 4B + Wave 9):** `GET /api/v1/workflows` filterable graph list + `?runs=1` Recent Runs tab + interactive SVG topology `WorkflowGraphCanvas` |

## Measurement and final cutover gate

`scripts/hybrid-runtime.mjs` selects between Node (`scripts/server.mjs`) and Rust hybrid
(`mso-shell-host`) with automatic fail-safe fallback and zero state conversion.
`scripts/bench-hybrid-same-host.mjs` captures exact SHA, Node version, CPU/RAM, Rust startup
(2.75 ms), idle/active RSS (2.6/2.8 MiB), HTML+CSP TTFB (0.455 ms p50), and native `fs_jail`
search (0.480 ms p50).

Do not switch `mso.service` in production without live-host rollback verification and
real-device proof for desktop, narrow mobile, and iOS PWA standalone mode.

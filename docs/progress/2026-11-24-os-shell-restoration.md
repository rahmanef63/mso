# 2026-11-24 - OS Shell Restoration, Asset Packaging SSOT, and Offline Demo Mode

## Summary

- Restored independent desktop/mobile OS shell preferences, startup bootstrap, and accessibility CSS (`reduce-glass`, `high-contrast`, `reduced-motion`) across all 5 shell presentations (`macos`, `windows`, `dashboard`, `ios`, `android`).
- Restored 5-shell presentations for Settings (`macos-sidebar`, `windows-rail`, `ios-stack`, `android-list`, `dashboard-tabs`) and Files (`finder`, `explorer`, `ios-files`, `android-files`, `dashboard`) with single-header mobile framing (`SHELL_DESIGN_PROFILES` in `frontend/svelte/src/lib/shell/shell-design.ts`).
- Established `public/` -> `frontend/svelte/tooling/public-assets.mjs` -> `frontend/svelte/build/` as the static asset packaging SSOT, fixing cold deep-links (`/settings`, `/files`, etc.) without breaking 404 responses on missing extensioned assets, and stamping `__MSO_BUILD_SHA__`, `__MSO_BUILD_MODE__`, and `build-meta.json`.
- Added an offline mock demo layer (`frontend/svelte/src/lib/demo/demo-adapter.ts` + `DemoBanner.svelte`) registered as the 23rd Svelte module (`22` core + `1` `demo` support module in `frontend/svelte/src/lib/feature-contracts.ts`), enabling full 33-app interactive preview with zero VPS/login/network dependencies and an independent Desktop/Tablet/Phone viewport preview selector.
- Updated `DESIGN.md` and `docs/SVELTE-IMPLEMENTATION.md` to match the post-Next.js Svelte 5 + Rust/Node codebase.

## Run commands

- **Offline mock demo (single command, zero VPS/login/network):**
  ```bash
  cd frontend/svelte && MSO_DEMO_MODE=1 bun run build && bun run preview
  ```
  (Or open any served build with `/?demo=1` or `/?demo=true`.)
- **Live Svelte + Rust/Node integration:**
  ```bash
  # Terminal 1: start MSO backend on 127.0.0.1:3000 (Node server or Rust hybrid shell)
  bun run start
  # Terminal 2: launch Svelte dev server proxying /api/* to loopback backend
  cd frontend/svelte && MSO_SVELTE_API_ORIGIN=http://127.0.0.1:3000 bun run dev
  ```

## Verified repository inventory

- **App registry (`frontend/svelte/src/lib/shell/shell-registry.ts`, `LazyWindowBody.svelte`):** 33 app IDs (`23` available to all authenticated roles, `10` owner-only).
- **Svelte feature modules (`frontend/svelte/src/lib/feature-contracts.ts`):** 23 modules (`22` core modules + `1` `demo` support module).
- **OS shell presentations (`chrome-profile.ts`, `shell-design.ts`):** 5 shells (`macos`, `windows`, `dashboard`, `ios`, `android`).

## Complete 33-App and Shell Surfaces Matrix

### A. Registered Apps (33 / 33)

| App/Surface | Module Contract | Route/Slug | Role | Primary Journey | External/Service Limit | Restoration Status |
|---|---|---|---|---|---|---|
| Alfa Assistant | `assistant` (`frame`) | `/assistant` | Authenticated | Model list + streaming SSE chat (`AssistantApp.svelte`) | Requires configured AI provider key in live mode; synthetic SSE in demo mode | Implemented (unit/demo verified) |
| Files | `files` (`frame`) | `/files` | Authenticated | Browse, read, edit, mkdir, delete, search, copy, move across 5 shell variants (`FilesManager.svelte`) | Live host fs jail; mutable in-memory `/home/demo` VFS in demo mode | Restored (5-shell presentations + demo VFS) |
| Code Editor | `editor` (`frame`) | `/editor` | Authenticated | Open/edit/save text files with `Ctrl/Cmd+S`, revert, dirty-close guard (`CodeEditorApp.svelte`) | Uses `/api/v1/fs/read` and `write`; works offline via demo VFS | Implemented (unit/demo verified) |
| Docs | `docs` (`frame`) | `/docs` | Authenticated | Safe structured changelog reader + Quick Reference (`DocsApp.svelte`) | Reads `/api/changelog` | Implemented (unit/demo verified) |
| Workflows | `workflows` (`frame`) | `/workflows` | Authenticated | Graph inventory, Recent Runs tab, SVG topology canvas (`WorkflowsApp.svelte`) | Live execution requires backend workflow engine | Implemented (unit/demo verified) |
| n8n | `runtime-apps` (`iframe`) | `/n8n` | Authenticated | Inspect managed `n8n` health/version and open external dashboard (`N8nApp.svelte`) | External Docker/n8n service + split-origin dashboard URL; disabled in offline demo | Implemented (external service gated) |
| Organization | `organization` (`frame`) | `/organization` | Authenticated | Browse org units, seats, and agent bindings (`OrganizationApp.svelte`) | Live bindings depend on host agent config | Implemented (unit/demo verified) |
| Extensions | `catalog` (`frame`) | `/extensions` | Authenticated (Skills tab Owner-only) | Inspect modular features (`~/.mso/features`) and skills/recipes (`ExtensionsView.svelte`) | Live features require host feature packs | Implemented (unit/demo verified) |
| Media Viewer | `media` (`frame`) | `/media` | Authenticated | Preview image/audio/video/text files from `/api/v1/fs/raw` (`MediaViewerApp.svelte`) | Requires readable media file on host or demo media | Implemented (unit verified) |
| Pickers | `media` (`frame`) | `/pickers` | Authenticated | Curated 24-icon picker + stock image search (`PickersApp.svelte`) | Stock image search requires external provider key in live mode | Implemented (external search gated) |
| Image Editor | `creative` (`frame`) | `/image-editor` | Authenticated | Load image, adjust brightness/contrast/saturation, rotate/flip, export PNG/JSON (`ImageEditorApp.svelte`) | Client Canvas processing; reads host `/api/v1/fs/raw` | Implemented (unit verified) |
| Media Studio | `creative` (`frame`) | `/media-studio` | Authenticated | Multi-asset timeline preview and clip reorder/remove (`MediaStudioApp.svelte`) | Reads host `/api/v1/fs/raw` | Implemented (unit verified) |
| Reel Editor | `creative` (`frame`) | `/reel-editor` | Authenticated | 9:16 vertical preview, caption overlay, clip timeline and scrub (`ReelEditorApp.svelte`) | Reads host `/api/v1/fs/raw` | Implemented (unit verified) |
| Camoufox Browser | `runtime-apps` (`iframe`) | `/camoufox` | Authenticated (power actions gated) | Start/stop Camoufox service and open external browser viewer (`CamoufoxApp.svelte`) | External Camoufox systemd/container runtime + viewer origin; unavailable offline | Implemented (external runtime gated) |
| Bot Desktops | `runtime-apps` (`iframe`) | `/bot-desktops` | Authenticated (lifecycle gated) | Inspect desktop containers, screenshots, logs, start/stop/restart (`BotDesktopsApp.svelte`) | External Docker desktop containers; unavailable offline | Implemented (external runtime gated) |
| Processes | `monitor` (`frame`) | `/processes` | Authenticated | View live/native host process inventory (`ProcessesList.svelte`) | Host `/proc` or Rust `--native-metrics`; synthetic in demo | Implemented (unit/demo verified) |
| Services | `monitor` (`frame`) | `/services` | Authenticated (actions Operator/Owner) | Inspect systemd units and trigger allowlisted start/stop/restart (`ServicesList.svelte`) | Host systemd supervisor + owner allowlist; synthetic toggle in demo | Implemented (unit/demo verified) |
| Packages | `managed-apps` (`frame`) | `/packages` | Authenticated | Read-only local OS package cache status (`PackagesView.svelte`) | Host package manager cache (`apt`/`dnf`/etc.) | Implemented (unit/demo verified) |
| Managed Apps | `managed-apps` (`frame`) | `/apps` | Authenticated | AppDeck managed OSS apps health, versions, dashboard links (`ManagedAppsView.svelte`) | Depends on host installed apps | Implemented (unit/demo verified) |
| Settings | `settings` (`frame`) | `/settings` | Authenticated (Audit/Updates Owner-gated) | 4-tab Preferences, Account, single in-Settings Updates, Audit Log across 5 shell nav modes (`SettingsApp.svelte`) | Host git update/audit logs require live host; prefs mutable in demo session | Restored (5-shell navigation + a11y/shell prefs) |
| Shell Settings | `shell` (`shell`) | `/shell-settings` | Authenticated | Independent desktop/mobile shell picker, theme, wallpaper, font scale, a11y toggles (`ShellSettingsApp.svelte`) | Persists to `/api/prefs` (in-memory during demo) | Restored (independent desktop/mobile prefs) |
| Clipboard | `shell` (`shell`) | `/clipboard` | Authenticated | Inspect and reuse session clipboard entries (`ClipboardPanel.svelte`) | Client-scoped session clipboard | Implemented (unit verified) |
| Inspector | `shell` (`shell`) | `/inspector` | Authenticated | Inspect active window layout, resolved chrome, viewport width, and role (`InspectorPanel.svelte`) | Client runtime state only | Implemented (unit verified) |
| Agent Vault | `agent-vault` (`frame`) | `/agent-vault` | Owner | Load, sync, and read Obsidian-compatible repo vault snapshots (`AgentVaultApp.svelte`) | Requires configured local project roots in live mode | Implemented (unit/demo verified) |
| Agent Groups | `agent-group` (`frame`) | `/agent-group` | Owner | View multi-agent groups, start/stop discussion runs (`AgentGroupApp.svelte`) | Live runs require configured agent providers/channels | Implemented (unit/demo verified) |
| Create App | `create-app` (`frame`) | `/create-app` | Owner | Register and remove custom schema-v1 shell app manifests (`CreateAppView.svelte`) | Host surface registry persistence; read-only in demo | Implemented (unit/demo verified) |
| Memory Graph | `memory-graph` (`frame`) | `/memory` | Owner | Explore knowledge/memory nodes, edges, and open notes in Code Editor (`MemoryGraphApp.svelte`) | Live graph reads host memory store | Implemented (unit/demo verified) |
| App Store | `catalog` (`frame`) | `/store` | Owner | Browse managed + connected app catalog (`AppStoreView.svelte`) | Remote catalog fetch on live host | Implemented (unit/demo verified) |
| Infrastructure | `infra` (`frame`) | `/infra` | Owner | View Dokploy, Cloudflare, and canonical single `convex` provider status (`InfrastructureView.svelte`) | Live provider status requires configured credentials | Implemented (unit/demo verified) |
| Integrations | `integrations` (`iframe`) | `/integrations` | Owner | Inspect connected profiles and providers with canonical `convex` (`IntegrationsView.svelte`) | Live OAuth/Composio tokens live on host only | Implemented (unit/demo verified) |
| Channels | `integrations` (`iframe`) | `/channels` | Owner | Inspect Telegram/Discord channels and run connectivity test (`ChannelsView.svelte`) | Live webhook/bot checks require configured channel tokens | Implemented (unit/demo verified) |
| Terminal | `terminal` (`frame`) | `/terminal` | Owner | Interactive PTY session over `term/open` + base64 UTF-8 SSE `term/stream` (`TerminalApp.svelte`) | Requires live host `node-pty` session; live stream unavailable offline | Implemented (host PTY required) |
| Devices | `auth` (`support`) | `/devices` | Owner | Approve pending devices, change roles, revoke sessions (`DevicesPanel.svelte`) | Live session store on host | Implemented (unit/demo verified) |

### B. Shell Surfaces, Native HTML Routes, and Overlays

| App/Surface | Module Contract | Route/Slug | Role | Primary Journey | External/Service Limit | Restoration Status |
|---|---|---|---|---|---|---|
| Login & Device Pairing | `auth` (`support`) | `/` (unauthenticated) | Public | Password login, 128-bit device ID, pending-device guidance (`LoginForm.svelte`) | Bypassed in `?demo=1` / `MSO_DEMO_MODE=1` | Implemented |
| First-Login Onboarding | `auth` (`support`) | `/settings` (Account tab) | Authenticated | Display name, avatar preset, password rotation (`AccountOnboardingCard.svelte`) | Password rotation writes `.env.local` on live host | Implemented |
| Lock Screen | `shell` (`shell`) | Overlay (`LazyModals`) | Authenticated | Lock/unlock workspace overlay and sign out (`LockScreen.svelte`) | Client overlay state | Restored |
| Command Palette | `shell` (`shell`) | Overlay (`Ctrl/Cmd+K`) | Authenticated | Search and launch all visible apps and shell actions (`CommandPalette.svelte`) | Role-filtered command list | Implemented |
| Shell Dialogs & Launchers | `shell` (`shell`) | Overlays (`LazyModals` / `WorkspaceRoot`) | Authenticated | Control Center, Force Quit, Shortcut Help (`Shift+?`), Windows Start/Run, macOS Launchpad/Mission Control, Context Menu | Client shell chrome overlays | Restored across 5 shells |
| Notifications | `shell` (`shell`) | Overlay (`NotificationToast.svelte`) | Authenticated | Transient status/error toasts (`notifications-store.ts`) | Client session notifications | Implemented |
| Error States & Boundaries | `shell` (`shell`) | Inline / Overlay | All | `<svelte:boundary>` window isolation, `LazyWindowBody` catch alert, `LazyModals` retry banner | Prevents single-slice crash from taking down shell | Implemented |
| Demo Banner & Viewport Preview | `demo` (`support`) | Top bar (demo mode only) | Public (demo) | Displays `Demo mode · Offline synthetic data · Build <sha>` and independent Desktop/Tablet/Phone viewport switcher (`DemoBanner.svelte`) | Shown only when `isDemoMode()` is true | Implemented (unit verified) |
| Native HTML: OAuth Consent | Server route (`app/oauth`) | `/oauth/authorize` | Authenticated | OAuth 2.1 authorization consent HTML rendered by Web Fetch handler (`app/oauth/authorize/route.ts`) | Requires live HTTP server (`scripts/server.mjs`) | Implemented (server-rendered HTML) |
| Native HTML: Integration Embeds | Server route (`app/integrations`) | `/integrations/embed`, `/integrations/manager` | Owner | Native HTML embed/manager routes (`app/integrations/`) | Requires live HTTP server and configured integrations | Implemented (server-rendered HTML) |

## Verification Notes (this slice)

- `frontend/svelte/tests/demo-adapter.test.ts`: passed (5/5 tests, covering `isDemoMode`, virtual filesystem list/read/write/mkdir/copy/move/search/delete/usage, session-isolated `/api/prefs`, full 33-app API schema compliance with zero network `baseFetch` calls, and idempotent `installDemoFetch`/`uninstallDemoFetch`).
- `cd frontend/svelte && bun run check` (`svelte-check`): passed (0 errors, 0 warnings).
- `node scripts/check-features.mjs`: passed (`slicesMissingContract: 0`, `orphanContractEntries: 0`, `rawLocalStorageSlices: 0`, `minifiedProductionFiles` within ratchet).
- `node scripts/check-contrast.mjs`: passed (36 presets x 2 modes + `app/globals.css`, 0 failures light, 0 failures dark).
- Note for branch integration:
  - `node scripts/check-architecture.mjs` currently reports `filesOver500: 1 / max 0` solely from sibling test file `frontend/svelte/tests/os-shell-matrix.mjs` (900 lines); all demo files are `<= 209` lines.
  - Adding the 23rd Svelte module (`demo`) requires updating the `svelte-modules` marker (`22` -> `23`) and adding `demo` in `docs/SLICE-CATALOG.md` before `node scripts/check-docs.mjs` passes.
  - Full live Chromium visual QA and production deployment remain separate verification stages.

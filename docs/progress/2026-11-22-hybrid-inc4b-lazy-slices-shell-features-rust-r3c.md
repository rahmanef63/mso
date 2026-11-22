# Progress Note: Hybrid Svelte Increment 4B + Rust Stage R3C (Lazy Slices, Editor, Docs, Workflows, Integrations, Channels & Shell Features)

- **Date:** 2026-11-22
- **Branch / Worktree:** `feat/hybrid-svelte-rust-shell` (`~/.cache/mso-worktrees/mso-hybrid-svelte-rust`)
- **Formula progress:** **52.1% -> 56.3% (~56%)** combined (`Svelte 61.8%`, `Rust Shell 48.0%`; **13 / 33 slices** + `appshell` lazy window manager + 3/10 shell features)

## Delivered

1. **Rust Stage R3C (`rust-shell/crates/mso-shell-core`):**
   - Added 8 reviewed route policies to `proxy.rs` (31 total routes): `/api/changelog` (`GET`), `/api/skills` (`GET`), `/api/memory` (`GET`/`POST`, 64 KiB), `/api/v1/memory-graph` (`GET`), `/api/v1/workflows` (`GET`/`POST`, 256 KiB), `/api/v1/integrations` (`GET`/`POST`, 64 KiB), `/api/v1/channels` (`GET`/`POST`, 64 KiB), and `/api/v1/organization` (`GET`/`POST`, 64 KiB).
   - Preserved `404` blocks on `/api/config`, `/api/v1/exec/run`, and `/api/v1/editor/exec`.
2. **Lazy Dynamic Slice Loading (`frontend/svelte/src/lib/shell/LazyWindowBody.svelte`):**
   - Converted all 14 workspace windows in `+page.svelte` to cached dynamic `import(...)` chunks, cutting initial cold `firstLoadJsBytes` by **32.2%** (`192,102 B -> 130,242 B`; `nodes/2.js` gzip `30.42 KiB -> 12.00 KiB`) despite adding 5 more slices.
3. **Svelte Increment 4B Slices:**
   - `code-editor` (`src/lib/editor/`): `fs/read` + `fs/write`, language/line/char/byte stats, scroll-synced line gutter, `Ctrl/Cmd+S`, Revert, and AppShell dirty close guard.
   - `docs` (`src/lib/docs/`): safe structured `GET /api/changelog` parser (zero `{@html}`) + filter + Quick Reference tab.
   - `workflows` (`src/lib/workflows/`): filterable `GET /api/v1/workflows` graph list + `?runs=1` Recent Runs tab.
   - `integrations` & `channels` (`src/lib/integrations/`): Owner-only `GET /api/v1/integrations` (canonical single `convex` provider, zero secret rendering) and `GET/POST /api/v1/channels` (inventory + non-destructive Test action).
4. **AppShell Features (`src/lib/shell/`):**
   - `CommandPalette.svelte` (`search`, `Ctrl/Cmd+K`), `NotificationToast.svelte` (`notifications`, max-5 queue), `ShortcutHelp.svelte` (`Shift+?`), and `chrome-profile.ts` (5-OS profile selector contract `data-chrome`).

## Verification evidence (synthetic fixtures only, local)

- `RUSTFLAGS="-D warnings" cargo test --workspace`: **29 / 29 PASS** (0 warnings); release binary **420 KiB**.
- `bun run svelte:check`: **0 errors, 0 warnings**; Svelte unit tests: **89 / 89 PASS**; `bun run svelte:audit`: clean at high/critical.
- `bun run svelte:e2e`: **PASS** across 320/390/1440px light+dark + 200% zoom + Increments 1..4B (Command Palette -> Docs, Code Editor save, Workflows, Integrations, Channels Test, Alfa SSE, Chrome profile switch).
- `bun run test:rust-host` (`R3C+Inc4B`): **PASS** (`idleRssKiB: 2448`, `activeRssKiB: 2824`), proving lazy slice chunks, POST SSE, Docs, Workflows, Integrations, Channels Test, CSRF 403, 405, and 404 guards.
- `bun run perf:probe` (`cold-slow4g-4xcpu`): first-load JS **127.2 KiB raw** (**59.5 KiB transfer**), Desktop LCP **1242 ms** / CLS **0.0101**, Mobile LCP **1214 ms** / CLS **0.0437** (vs Next 3,000-3,200 ms).
- Repo gates: `check-architecture.mjs` (`filesOver220: 47/47`), `check-cycles.mjs` (`0`), `check-features.mjs`, `check:instance-literals`, and `check-docs.mjs` all **PASS**.

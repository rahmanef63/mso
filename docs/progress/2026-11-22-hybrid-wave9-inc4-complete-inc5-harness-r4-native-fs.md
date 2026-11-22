# Progress Note: Hybrid Wave 9 (Inc. 4 100%, Inc. 5 Cutover/Benchmark Harness, Rust R3G/R4 Full Native FS & R1 Desktop Multi-Profile)

- **Date:** 2026-11-22
- **Branch / Worktree:** `feat/hybrid-svelte-rust-shell` (`~/.cache/mso-worktrees/mso-hybrid-svelte-rust`)
- **Formula progress:** **80.9% -> 87.8% (~88%)** combined (`Svelte 91.0%`, `Rust Shell 83.0%`; **Inc. 1-4 100%**, **Inc. 5 40%**, **R1 50%**, **R3 85%**, **R4 90%**)

## Delivered

1. **Rust Stage R3G + Stage R4 Full Native FS (`rust-shell/crates/mso-shell-core`):**
   - Added `/api/health`, `/api/status`, `/api/v1/fs/upload`, `/api/v1/fs/zip` to `proxy.rs` (62 total route policies) plus loopback `GET /healthz` (`200 {"ok":true,"runtime":"mso-shell-host"}`).
   - Added `list_jailed_dir` and `read_jailed_text` to `fs_jail.rs` (symlink-escape safe, blocking `.env`/`.ssh`/`.mso`/`*.pem`/`*.key`, 500-entry cap, 512 KiB read cap) and wired them into `server.rs` under opt-in `--native-fs-root`.
2. **Svelte Increment 4 -> 100% Complete (`frontend/svelte/src/lib/files/` & `workflows/`):**
   - `FilesOpsPanel.svelte` wired into refactored `FilesManager.svelte` (205 lines): live Search files + inline Copy/Move UI.
   - `WorkflowGraphCanvas.svelte` wired into `WorkflowsApp.svelte` (198 lines): interactive SVG workflow topology preview (`role="img"`).
3. **Increment 5 Cutover Runtime Selector & Same-Host Benchmark (`scripts/`):**
   - `scripts/hybrid-runtime.mjs` (189 lines): deterministic `next` (default) vs `hybrid` selector with fail-safe rollback to `next` on missing prereqs and deterministic zero-conversion `buildRollbackPlan`.
   - `scripts/bench-hybrid-same-host.mjs` (203 lines): live same-host benchmark harness capturing SHA, CPU/RAM, startup time, RSS, HTML+CSP TTFB, native `sys_metrics`, and native `fs_jail` search latency.
4. **Stage R1 Desktop Multi-Profile & Cross-Layer Contract (`rust-shell/desktop-tauri/` & `tests/desktop-contract.test.ts`):**
   - Added `profiles.rs` (`HostProfileStore`, max 16 validated host profiles, unit-tested 4/4 via `rustc --test -D warnings`), `build-desktop.workflow.yml.example` (Linux/macOS/Windows CI matrix), and `desktop-contract.test.ts` (executes real JS bootstrap from `main.rs` against `shell-bridge.ts` in `node:vm`).

## Verification evidence (local, same-host synthetic fixtures — prod untouched)

- `RUSTFLAGS="-D warnings" cargo test --workspace`: **62 / 62 PASS** (`+ 4/4 profiles.rs` via `rustc --test`); release binary **536 KiB**.
- `bun run svelte:check`: **0 errors, 0 warnings**; Svelte unit tests: **172 / 172 PASS**; `bun run svelte:audit`: clean.
- `bun run svelte:e2e`: **PASS** across 320/390/1440px light+dark + 200% zoom + Files Search/Copy/Move UI + Workflows SVG topology.
- `bun run test:rust-host`: **PASS** (`idleRssKiB: 2628`, `activeRssKiB: 3000`, `routePolicies: 62`, `/healthz` verified, live Chromium listed & read `public-note.txt` from Rust `--native-fs-root` with `.env` hidden and zero Node `/api/v1/fs/*` or `/api/v1/sys/stats` calls).
- `node scripts/bench-hybrid-same-host.mjs` (Linux x64, 16 CPUs): startup **2.75 ms**, idle/active RSS **2,636 / 2,812 KiB**, HTML+CSP p50 **0.455 ms**, native `fs_jail` search p50 **0.480 ms**, native `sys_metrics` p50 **51.18 ms** (`upstreamCallsDuringNative: 0`).
- Repo gates: `check-architecture.mjs` (`filesOver220: 47/47`), `check-cycles.mjs` (`0`), `check-features.mjs`, `check:instance-literals`, `env-example.test.ts` (`2/2`), and `check-docs.mjs` all **PASS**.

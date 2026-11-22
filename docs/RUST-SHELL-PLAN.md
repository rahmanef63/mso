# Hybrid Svelte + Rust Shell Plan

> **Implementation contract & Increment 4C / Rust Stage R3D + R1 Desktop Contract record (2026-11-22).**
> **Stage R0**, **Stage R1 contract (`desktop.rs`, 15%)**, **Stage R2 (100%)**, **Stage R3D (39 reviewed routes + GET/POST SSE)**,
> and **Svelte Increments 1, 2 (90%), 3 (100%), and 4C (55%)** — covering **19 / 33 slices**
> (18 workspace slices + `appshell` lazy window manager), **8 / 10 AppShell features**, and the
> 5 OS chrome profile contract — are implemented and verified on this branch. Production remains
> Next.js/React until cutover.

## 1. Progress percentage tracker (formula-based, 2026-11-22)

Progress is computed strictly from weighted milestone gates (never guessed from line counts):

### A. Svelte Static Frontend Track (weight in hybrid program: 60%)

| Milestone | Weight | Status | Completion | Weighted |
|---|---|---|---|---|
| Increment 1: Static entry + monitor probe + `shell-bridge` | 10% | Merged on `main` (PR #285) + audited | 100% | 10.0% |
| Increment 2: Auth/devices/CSRF (2A) + managed-host/OAuth/MCP edge parity (2B) | 15% | **2A & 2B edge landed; first-login onboarding sub-flow pending** | 90% | 13.5% |
| Increment 3: AppShell window manager + URL sync + crash isolation + Files + Terminal | 25% | **Done (100%):** window store, `<WindowFrame>` + `<svelte:boundary>`, URL sync, full `files-manager`, `os-terminal` | 100% | 25.0% |
| Increment 4: Remaining slices + 5 OS chromes + 10 AppShell features | 35% | **4C landed (55%):** 19/33 slices + `LazyWindowBody` + **8/10 shell features** (`search`, `notifications`, `shortcut-help`, `clipboard`, `control-center`, `force-quit`, `lock-screen`, `inspector`); 14 slices, full 5-OS visual chromes & 2 shell features (`desktop-icons`, `widgets`) pending | 55% | 19.3% |
| Increment 5: Full Next cutover + same-host RSS/CPU/latency proof + rollback | 15% | Not started | 0% | 0.0% |
| **Total Svelte Track** | **100%** | **19 / 33 slices + 8 / 10 AppShell features** | **67.8%** | **67.8%** |

### B. Rust Shell & Native Desktop Track (weight in hybrid program: 40%)

| Stage | Weight | Status | Completion | Weighted |
|---|---|---|---|---|
| **R0:** `mso-shell-core` + loopback static host + asset jail + nonce CSP | 15% | **Done** | 100% | 15.0% |
| **R1:** Tauri v2 native desktop client (`mso-desktop-tauri`, Linux/macOS/Windows) | 25% | **Contract landed (15%):** `desktop.rs` profiles, `mso://open/...` deep-links & bridge bootstrap JSON; native binary gated on host `webkit2gtk-4.1` / `gtk3` / `pkg-config` | 15% | 3.8% |
| **R2:** Auth/CSRF/body/cookie (R2A) + managed-app split-origin, OAuth/MCP/A2A, & WebSocket tunnel (R2B) | 25% | **Done** | 100% | 25.0% |
| **R3:** Retire `next-server` + `scripts/server.mjs` in production (R3D: GET+POST SSE + 39 reviewed routes landed) | 20% | **In progress (50% - 39 routes + streaming ready; full cutover gated on Svelte Inc. 5)** | 50% | 10.0% |
| **R4:** Selective native host primitives (aligned with [`NATIVE-HOST-RELAY.md`](./NATIVE-HOST-RELAY.md)) | 15% | Planned | 0% | 0.0% |
| **Total Rust Shell Track** | **100%** | **R0 + R2 complete; R1 contract & R3D 39-route host verified** | **53.8%** | **53.8%** |

### C. Combined Hybrid Program

- **Progression:** `12.0%` (R0) -> `22.4%` (R2A) -> `39.8%` (R2B/3A) -> `47.6%` (3B/SSE) -> `52.1%` (4A/R3B) -> `56.3%` (4B/R3C) -> **62.2% (~62%)** (4C/R3D, 2026-11-22).
- **Formula:** `0.60 * 67.8% + 0.40 * 53.8%` = **62.2%**.
- **When Native Desktop App becomes usable:** Completing the remaining 85% of **Stage R1 (Tauri v2)** after installing WebKitGTK/GTK3 packages delivers a native desktop client (Linux/macOS/Windows) wrapping MSO.
- **When production server RAM drops (~284 MiB -> <40 MiB):** Only at **100% cutover (Increment 5 + Stage R3)** when `next-server` + `scripts/server.mjs` are retired.

## 2. Why hybrid instead of a full Rust rewrite

Measured MSO baselines in [`MSO-MIGRATION.md`](./MSO-MIGRATION.md) and
[`BENCH-BEFORE.md`](./BENCH-BEFORE.md) show two separate bottlenecks:

1. **Client UI latency is hydration-bound, not server-bound.** Live API TTFB is 4-8 ms and HTML
   TTFB is 10-14 ms, while cold Slow 4G + 4x CPU desktop LCP is 3.0-3.2 s because of ~910 KiB
   raw (270.8 KiB gzip) first-load JS (47.9% Next+React). **Svelte 5 static output** with lazy
   per-window slice chunks attacks that critical path directly.
2. **Server footprint is runtime-bound.** The live Next cockpit uses ~284 MiB idle RSS
   (`next-server` 110 MiB + `scripts/server.mjs` 174 MiB) and ~1.4-1.6 GiB `node_modules`. A
   standalone **Rust shell** solves native desktop packaging (Tauri v2) and low-RSS static/proxy
   serving without rewriting ~100k LOC of portable `lib/` orchestration, MCP, OAuth, and A2A code
   prematurely.

## 3. Target hybrid architecture (one UI -> Web/PWA + Native Desktop)

```mermaid
flowchart LR
  UI["Shared Static UI (frontend/svelte/build, 21 lazy slice chunks)"]
  Web["Browser / iOS PWA (HTTPS)"]
  Desktop["Native Desktop App (Tauri v2 + mso-shell-core::desktop)"]
  Core["rust-shell/crates/mso-shell-core (Origin, Asset Jail, CSP Nonce, CSRF, Managed Hosts, WS + GET/POST SSE)"]
  Host["MSO Host Runtime (Linux / WSL2 / Lima / VPS)"]

  UI --> Web
  UI --> Desktop
  Desktop --> Core
  Web --> Core
  Core -->|"Loopback HTTP/WS/SSE or Remote HTTPS"| Host
```

- **One frontend codebase:** `frontend/svelte/build` serves both Web/PWA and the Tauri v2 desktop
  WebView. Existing web-native surfaces (`xterm.js`, canvas/media editors, iframe managed apps,
  Camoufox noVNC, MCP Apps) remain compatible without reimplementing a second GUI stack.
- **Explicit host boundary:** Per [`PLATFORMS.md`](./PLATFORMS.md) and
  [`NATIVE-HOST-RELAY.md`](./NATIVE-HOST-RELAY.md), a Tauri desktop app on macOS or Windows
  operates first as a **native desktop client** connected to a verified Linux/WSL2/Lima/VPS MSO
  host. Native non-Linux host execution stays gated on real-machine OS adapter proofs.

## 4. Phased Rust shell roadmap

| Stage | Scope | Status | Prerequisites & acceptance gates |
|---|---|---|---|
| **R0** | **Rust shell core & loopback static host** (`mso-shell-core` + `mso-shell-host`, zero external crates): origin guard parity, canonicalized asset path-jail, per-request CSP nonce injection on SvelteKit HTML, plus `shell-bridge.ts`. | **Done (100%)** | `RUSTFLAGS="-D warnings" cargo test --workspace`, `cargo build --release`, `bun run test:rust-host`. |
| **R1** | **Tauri v2 native desktop client shell** (`mso-shell-core::desktop` + future `mso-desktop-tauri`): pure-`std` `DesktopHostProfile`, `mso://open/...` deep-link parser, and `window.__MSO_DESKTOP_SHELL__` bootstrap JSON landed; Tauri binary packaging pending host OS libs. | **In progress (15%)** | Linux build packages (`pkg-config`, `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`), crates.io access, plus real-machine smoke proofs on Linux, macOS, and Windows. |
| **R2** | **R2A:** CSRF depth-2 (`csrf.rs`), bounded HTTP body parser (`413`), multi `Set-Cookie`, auth/devices allowlist. **R2B:** Managed-app split-origin host classification (`managed.rs`), CSRF-exempt OAuth/MCP/A2A passthrough with `Authorization`, Increment 3A routes, and bounded WebSocket upgrade tunnel (`ws.rs`). | **Done (100%)** | 21+ Rust unit tests + live Chromium R2B smoke test. |
| **R3** | **Streaming SSE & production cutover without `next-server`:** GET+POST SSE (`sse.rs`) plus **39 reviewed routes** (including `/api/v1/app-catalog`, `/api/v1/features`, `/api/v1/sys/audit`, `/api/v1/infra/providers`, `/api/v1/agent-vault`, `/api/v1/agent-groups`, `/api/v1/agent-profiles`, `/api/v1/agent-sessions`); full retirement of `next-server` + `scripts/server.mjs` gated on Svelte Inc. 5. | **In progress (50%)** | 35/35 Rust tests + live Chromium R3D+Inc4C smoke test; full cutover requires 33-slice Svelte parity & same-host RSS/CPU/latency proof. |
| **R4** | **Selective native host primitives** (aligned with [`NATIVE-HOST-RELAY.md`](./NATIVE-HOST-RELAY.md)): evaluate porting high-I/O host calls (`fs` jail/search, `sys` metrics, `portable-pty`, outbound relay) where measured gains justify dual-language maintenance. | **Planned (0%)** | Measured CPU/RSS/latency win on the same host; strict containment & credential denylist parity; do not port `lib/orchestration` prematurely. |

## 5. Measured evidence progression (2026-11-21 to 2026-11-22)

Captured on Linux x86_64 (`rustc 1.99.1`, `node v24.22.2`, `bun 1.4.2`, Chromium headless) against
synthetic fixtures on `feat/hybrid-svelte-rust-shell`. These figures prove **Stage R3D host and
Increment 4C workspace behavior only** and must not be represented as full 33-slice cockpit parity.

| Measurement | R0 (11-21) | R2B+SSE / 3B | R3B / 4A | R3C / 4B | R3D / 4C (11-22) |
|---|---|---|---|---|---|
| `mso-shell-host` release binary | 375 KiB | 417 KiB | 419 KiB | 420 KiB | **421 KiB** (stripped, LTO, 0 external crates) |
| `mso-shell-host` idle / active `VmRSS` | 2,416 / 2,860 KiB | 2,508 / 2,964 KiB | 2,444 / 2,888 KiB | 2,448 / 2,824 KiB | **2,508 KiB (~2.5 MiB)** / **2,932 KiB (~2.9 MiB)** |
| Rust unit tests (`-D warnings`) | 10 / 10 | 24 / 24 | 26 / 26 | 29 / 29 | **35 / 35 PASS** (39 routes + `desktop.rs` + SSE/WS/CSRF) |
| First-load JS (cold `perf:probe`) | 109.7 KiB raw | 156.7 KiB raw | 187.6 KiB raw | 127.2 KiB raw | **137.7 KiB raw / 66.3 KiB transfer** (21 lazy chunks) |
| Svelte unit & Chromium E2E | 20 unit | 56 unit | 71 unit | 89 unit | **105 / 105 unit tests** + **Inc. 1-4C Chromium E2E PASS** |
| Svelte cold load (Slow 4G + 4x CPU) | D 804 / M 802 ms | D 850 / M 836 ms | D 864 / M 864 ms | D 1242 / M 1214 ms | **D: LCP 1630 ms, CLS 0.0108; M: LCP 1486 ms, CLS 0.0474** (vs Next 3,000-3,200 ms) |

## 6. Explicit boundaries and non-goals

- Production remains Next.js/React (`mso.service`, installers, state, tunnels, and host policy are
  untouched).
- `rust-shell/` binds strictly to `127.0.0.1`, keeps `/api/config`, `/api/v1/exec/run`, and
  `/api/v1/editor/exec` blocked (`404`), and never widens CORS, cookie domains, or public binds.
- No desktop client or native OS parity claim is valid until built and verified on real Linux,
  macOS, and Windows machines under Stage R1 / [`NATIVE-HOST-RELAY.md`](./NATIVE-HOST-RELAY.md).

## 7. Local verification commands

```sh
# 1. Rust core & host binary (zero external crates)
cd rust-shell && RUSTFLAGS="-D warnings" cargo test --workspace && cargo build --release --bin mso-shell-host

# 2. Svelte static build + unit + E2E + audit
bun run svelte:check && bun run svelte:build && bun run svelte:e2e && bun run svelte:audit

# 3. Live Rust host serving Svelte build + Chromium R3D+Inc4C + CSP + CSRF + RSS check
cd frontend/svelte && bun run test:rust-host && bun run perf:probe
```

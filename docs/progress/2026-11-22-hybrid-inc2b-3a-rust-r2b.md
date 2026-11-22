# 2026-11-22 — Hybrid Increment 2B/3A & Rust Shell Stage R2B (Split-Origin, WS Tunnel, Window Manager, Files, Processes)

## Summary

Executed three disjoint parallel workstreams advancing the hybrid Svelte + Rust Shell program
from **22.4% -> ~39.8% (~40%)** combined completion (Svelte track **39.6%**, Rust Shell track
**40.0%** with **Stage R2 100% complete**).

## Changes

- **Rust Shell Stage R2B (`rust-shell/`):**
  - Added `src/managed.rs` mirroring `lib/managed-apps/origin.ts`: host template classification
    (`Cockpit`, `ManagedApp(id)`, `UnclaimedAppNamespace`), unclaimed subdomain `404`, `/_next/*`
    `404` on managed hosts, `x-os-managed-app-host` stamping/stripping, and CSRF-exempt machine
    protocol detection (`/mcp`, `/oauth/token`, `/oauth/register`, `/.well-known/oauth-*`,
    `/a2a/v1`, `/.well-known/agent-card.json`).
  - Added `src/ws.rs` implementing a zero-dependency bounded bidirectional WebSocket upgrade
    tunnel (max 32 active sockets via RAII `AtomicUsize` guard, exact comma-token `Upgrade`
    matching, loopback-only upstream verification, `101 Switching Protocols` passthrough).
  - Expanded `src/proxy.rs`, `src/http.rs`, `src/server.rs`, and `mso-shell-host/src/main.rs`
    with Increment 3A routes (`/api/v1/sys/processes`, `/api/v1/fs/*`, `/api/v1/term/*`),
    `Authorization` passthrough on machine protocols, and `--managed-host-template`.
  - Verified **21/21** Rust unit tests (`RUSTFLAGS="-D warnings"`), **407 KiB** release binary,
    and **2,432 KiB idle / 2,768 KiB active VmRSS** in live Chromium smoke test (`test:rust-host`).
- **Svelte Increment 3A (`frontend/svelte/`):**
  - Added AppShell window manager (`src/lib/shell/window-store.ts`), `<WindowFrame>` with
    Svelte 5 `<svelte:boundary>` per-window crash isolation (`src/lib/shell/WindowFrame.svelte`),
    History API URL sync, and layout persistence helpers.
  - Added `files-manager` read/browse core (`src/lib/files/files-api.ts`, `files-controller.ts`,
    `FilesManager.svelte`) matching real `/api/v1/fs/list` and `/api/v1/fs/read` DTOs.
  - Expanded `system-monitor` with Process Inventory (`src/lib/monitor/processes-api.ts`,
    `ProcessesList.svelte`) matching real `/api/v1/sys/processes` DTO (`pid`, `name`, `status`,
    `cpu`, `mem` in MiB) with filter and sort.
  - Integrated into `+page.svelte`, `styles.css`, `tooling/backend-proxy.mjs`, and E2E suites:
    **43/43** unit tests pass, **47.8 KiB JS gzip** total client bundle, Slow 4G + 4x CPU cold
    load LCP **824 ms** desktop / **838 ms** mobile.
- **Docs Updated:** [`docs/RUST-SHELL-PLAN.md`](../RUST-SHELL-PLAN.md) and
  [`docs/SVELTE-IMPLEMENTATION.md`](../SVELTE-IMPLEMENTATION.md).

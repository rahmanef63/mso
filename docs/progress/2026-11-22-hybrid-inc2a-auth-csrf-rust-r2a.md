# 2026-11-22 — Hybrid Increment 2A & Rust Shell Stage R2A (Auth, Owner Devices, CSRF Depth-2)

## Summary

Advanced the hybrid Svelte + Rust Shell migration from **12% -> ~22%** combined completion
(Svelte track **19%**, Rust Shell track **27.5%**) by porting the core `auth` slice (1/33 full
slices) and upgrading `mso-shell-core` / `mso-shell-host` from Stage R0 read-only proxy to Stage
R2A auth + CSRF depth-2 edge enforcement.

## Changes

- **Rust Shell Core (`rust-shell/crates/mso-shell-core/`):**
  - Added `src/csrf.rs` mirroring `crossOriginMutation` from root `proxy.ts` (`Sec-Fetch-Site`,
    `Origin` vs `Host`/`X-Forwarded-Host`, and `session` cookie fallback) returning `403`
    `{"error":"cross_origin_blocked"}` before contacting upstream.
  - Extracted bounded HTTP/1.1 wire parsing into `src/http.rs` with strict request body limits
    (`413 {"error":"request_too_large"}`) and multi-header response support.
  - Upgraded `src/proxy.rs` and `src/server.rs` to an explicit 5-route Stage R2A allowlist
    (`/api/auth/me`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/devices`,
    `/api/v1/sys/stats`), preserving multiple `Set-Cookie` headers and blocking unlisted routes
    (`404`) and disallowed methods (`405`).
- **Svelte Frontend (`frontend/svelte/`):**
  - Added `src/lib/device.ts` (128-bit hex device ID mirrored in `localStorage` + `mso-device`
    cookie, matching `frontend/slices/auth/lib/device.ts`), `src/lib/devices-controller.ts`,
    `src/lib/LoginForm.svelte`, and `src/lib/DevicesPanel.svelte` (owner-only approvals with
    least-privilege `viewer` default, role selector, inline two-step revoke without
    `window.confirm()`).
  - Updated `src/lib/host-api.ts`, `src/lib/Monitor.svelte`, `src/routes/+page.svelte`,
    `src/styles.css` (reserving mobile `.session-actions` row to keep mobile CLS at `0.0515`),
    and `tooling/backend-proxy.mjs` (matching Stage R2A routes + CSRF depth-2).
  - Expanded unit tests (`26/26` pass), Playwright browser E2E (`tests/browser.mjs`), and live
    Rust-host Chromium + RSS smoke proof (`tests/rust-host-smoke.mjs`).
- **Docs & Progress Tracker:**
  - Updated [`docs/RUST-SHELL-PLAN.md`](../RUST-SHELL-PLAN.md) and
    [`docs/SVELTE-IMPLEMENTATION.md`](../SVELTE-IMPLEMENTATION.md) with formula-based percentage
    progress tables and Stage R2A / Increment 2A measured evidence.

# 2026-11-21 — Hybrid Svelte + Rust Shell Stage R0 and Svelte Track Audit

## Summary

Audited the existing Svelte migration track (`frontend/svelte/`) and implemented Stage R0 of the
hybrid Svelte 5 static UI + Rust shell architecture without altering the production Next.js/React
cockpit.

## Svelte Track Audit Findings

- Confirmed Increment 1 (PR #285, `1408640f`, 2026-11-09) is the only landed Svelte milestone:
  0/33 full slices ported (3 partial foundations: static entry layout, `/api/auth/me` session
  probe, one-shot `/api/v1/sys/stats` snapshot; 0/5 OS chromes; 0/10 AppShell features).
- Fixed a real selector defect in `frontend/svelte/tests/perf-probe.mjs` where the probe waited
  for `[data-monitor-state='ready']`, which did not exist in `Monitor.svelte` (causing a 20 s
  timeout per pass). Added `data-monitor-state={state.kind}` and wired `perf:probe` in
  `frontend/svelte/package.json`.
- Added a narrow fail-closed transport seam (`frontend/svelte/src/lib/shell-bridge.ts` + unit
  tests) so the same static Svelte bundle stays relative same-origin on Web/PWA and validates
  explicit HTTPS/loopback origins when hosted inside a Rust/Tauri desktop shell.

## Rust Shell Stage R0 & Updated Plan

- Added zero-dependency Rust workspace under `rust-shell/` (`mso-shell-core` + `mso-shell-host`):
  strict origin validation, canonicalized asset path-jail blocking traversal/symlinks/reserved
  `/api/*` fallback, per-request CSP nonce injection on SvelteKit HTML, and read-only loopback
  API proxy parity (`/api/auth/me`, `/api/v1/sys/stats`).
- Added live Chromium + RSS smoke test (`frontend/svelte/tests/rust-host-smoke.mjs`), verified at
  375 KiB release binary size, 2,416 KiB idle / 2,860 KiB active `VmRSS`, and 0 CSP/page errors.
- Added [`docs/RUST-SHELL-PLAN.md`](../RUST-SHELL-PLAN.md) covering Stages R0 through R4
  (including Tauri v2 desktop client prerequisites and gates), updated
  [`docs/SVELTE-IMPLEMENTATION.md`](../SVELTE-IMPLEMENTATION.md), and classified the new plan in
  [`docs/README.md`](../README.md).

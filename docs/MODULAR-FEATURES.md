# Modular features, dynamic gates, and feature contracts

> **Current reference.** Describes the modular feature package runtime, change-aware
> verification planner, and automated feature-governance ratchets on this branch.

## 1. Independent feature updates (`~/.mso/features/`)

Built-in UI modules under `frontend/svelte/src/lib/` compile into the core Svelte 5 static bundle. When a feature
should ship and update independently of the MSO core release cycle, package it as a **modular
feature** under owner-private `~/.mso/features/<id>/` (override via `MSO_FEATURES_DIR`).

### Package layout

```text
<package>/
  manifest.json   # schemaVersion: 1, id, version, title, minRole, entry, integrity
  dist/
    index.html    # entry file + any local JS/CSS/media assets
```

### Workflow (no MSO core rebuild or service restart)

```bash
# 1. Scaffold a standalone feature package outside the MSO checkout
bun run feature:pack init ~/my-features/ops-board ops-board "Ops Board"

# 2. Edit dist/index.html (or build your bundle into dist/) and bump manifest.json version

# 3. Validate, compute SHA-256 entry integrity, and atomically swap into ~/.mso/features/ops-board
bun run feature:pack deploy ~/my-features/ops-board

# 4. Inspect or uninstall
bun run feature:pack list
bun run feature:pack remove ops-board
```

MSO discovers installed packages dynamically through `GET /api/v1/features` and serves static
assets from `GET /api/v1/features/<id>/asset/<...path>` with:

- Live device-role authorization (`roleAtLeast(role, manifest.minRole)` on both listing and asset reads).
- Canonical `realpath` containment inside `dist/` (symlinks escaping the package are refused).
- SHA-256 integrity verification on the entry file (`manifest.integrity`).
- Same-origin sandboxed iframe framing (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store, private`).

Reloading the feature window (or refocusing the shell) loads the updated version immediately
without rebuilding the Svelte 5 / Rust core or restarting `mso.service`.

## 2. Dynamic change-aware gates

To avoid running the full monolith release suite on small localized edits while keeping full
release verification intact:

```bash
# Inspect what changed and which checks apply
bun run gate:plan

# Execute only the checks matching the current diff (docs-only, svelte-only, modular slice, or full)
bun run gate:smart

# Include isolated production build + affected E2E journeys only
bun run gate:smart -- --with-build

# Force the complete release gate
bun run gate:smart -- --full
```

Additional build and release speedups:

- `scripts/verify-build.sh` uses `cp -a --reflink=auto` when staging `node_modules`, supports
  `MSO_VERIFY_E2E_FILTER`, and supports bounded parallel E2E workers (`MSO_E2E_JOBS=2`).
- `scripts/self-update.sh` verifies and promotes the built Svelte 5 (`frontend/svelte/build`) and
  Rust Shell artifacts cleanly, avoiding redundant rebuild work.
- `scripts/run-svelte-if-changed.mjs` skips the isolated Svelte steps during local `verify`
  when `frontend/svelte/**` is untouched (always runs in `CI=true` or `MSO_VERIFY_FULL=1`).
- `scripts/gates.sh` automatically runs `scripts/run-smart-gate.mjs --pr-fast` on non-`main`
  feature branches (~20-45s instead of ~12 min), while pushes to `main` (`bun run ship`) and
  `bun run pr:local` (`MSO_GATE_FULL=1`) keep the complete release gate.

### Conflict-free PR docs (`docs/progress/` & `docs/CHANGELOG.md`)

- New PRs write standalone progress notes under `docs/progress/YYYY-MM-DD-<slug>.md` instead of
  prepending to line 1 of `docs/PROGRESS.md`, eliminating cross-PR merge conflicts.
- `scripts/gen-changelog.mjs --check` defers staleness checks on feature/PR branches when
  `docs/CHANGELOG.md` is unmodified relative to `origin/main` (strict checks remain active on
  `main` and in `bun run ship`), so parallel PRs never collide on `docs/CHANGELOG.md`.

## 3. Automated feature governance (`check:features`)

Every UI module under `frontend/svelte/src/lib/` is classified in `frontend/svelte/src/lib/feature-contracts.ts`
and checked automatically by `node scripts/check-features.mjs` (wired into `bun run check`)
against ratchets in `feature.boundaries.json`:

- Every module must declare a contract (`surfaceKind`, `minRole`, `stateStrategy`, `updatableTier`).
- New `window.confirm` / `alert` / `prompt` calls, new direct `localStorage` usage outside ratified
  boundaries, and new minified single-line files (>400 chars) are blocked by ratchets.
- Use shared shell confirm dialogs instead of `window.confirm()` and `host-api.ts` helpers for
  standardized 401/403/JSON error handling.

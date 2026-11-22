## 2026-11-21 — Modular feature packages, dynamic change-aware gates, and automated feature contracts

Three structural pain points surfaced during a full repository audit of all 33 slices, 5 gate runners, and the deployment pipeline:

1. **Slow prebuild & 30-minute PR loops:** `scripts/gates.sh` ran the full 12-minute release monolith on every feature-branch push (including 1-file fixes and merge-conflict commits), duplicated checks already run by `bun run verify`, ran 5 Svelte steps unconditionally, copied 2.3 GB of `node_modules` without reflinks, ran all E2E journeys sequentially, and `scripts/self-update.sh` ran a duplicate in-place `next build` after discarding the verified out-of-tree build. In addition, editing `docs/CHANGELOG.md` and prepending to `docs/PROGRESS.md` on every feature branch caused recurring merge conflicts across parallel PRs.
2. **Monolithic feature updates:** Every feature lived statically inside `BUILTIN_APPS`, requiring a full MSO rebuild and restart for any feature change.
3. **Unenforced feature rules:** `docs/FRONTEND-CONTRACT.md` was prose-only, allowing divergent behavior across slices (only 17/33 using `AppFrame`, 4/33 using `AppSidebar`, 5/33 using `useFeatureState`, 11/33 calling `window.confirm()`, 4 slices with zero unit tests, and 97 production files compressed onto >400-char lines).

### What changed

- **Dynamic gates, fast feature-branch pushes & conflict-free PR docs:**
  - Added `scripts/e2e/manifest.mjs`, `scripts/ci/affected.mjs` (`bun run gate:plan`), `scripts/run-smart-gate.mjs` (`bun run gate:smart`), and `scripts/run-svelte-if-changed.mjs`.
  - Updated `scripts/gates.sh` so pushes on feature branches run fast change-aware verification (`--pr-fast`, ~20–45s) while `main` pushes (`bun run ship`) and `bun run pr:local` (`MSO_GATE_FULL=1`) keep the full release gate.
  - Updated `scripts/gen-changelog.mjs --check` to defer staleness checks on feature/PR branches when `docs/CHANGELOG.md` is untouched vs `origin/main` (strict enforcement remains active on `main` and in tests), and introduced `docs/progress/YYYY-MM-DD-<slug>.md` so parallel PRs never conflict on `docs/CHANGELOG.md` or `docs/PROGRESS.md`.
  - Added `--reflink=auto`, `MSO_VERIFY_E2E_FILTER`, bounded parallel E2E jobs (`MSO_E2E_JOBS`), and atomic `.next` artifact promotion (`scripts/lib/promote-next-build.sh`) in `scripts/verify-build.sh` and `scripts/self-update.sh`.
- **Independent modular features (`~/.mso/features/`):**
  - Added `lib/contracts/modular-feature.ts`, race-free `O_NOFOLLOW` fd-based `lib/features/registry.ts`, `lib/features/http-service.ts`, `/api/v1/features` + `/api/v1/features/[id]/asset/[...path]`, shell integration (`ModularFeaturesProvider` / `ModularFeatureApp`), `mso mapp features` / `mso mapp feature-asset`, and `scripts/feature-pack.mjs` (`bun run feature:pack init|deploy|list|remove`).
- **Automated feature governance:**
  - Added `frontend/slices/feature-contracts.ts`, `feature.boundaries.json`, and `scripts/check-features.mjs` wired into `bun run check`; added `<ConfirmDialog>` and `featureFetch()`; added unit tests for all 4 previously untested slices (`bot-desktops`, `create-app`, `infrastructure`, `media-studio`) bringing `slicesWithoutTests` to 0; and cleaned up mixed Indonesian/English UI error strings and drifted slice counts in docs.

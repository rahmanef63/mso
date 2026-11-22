# Frontend agent instructions

Root `AGENTS.md` and `CLAUDE.md` remain authoritative. Before editing any frontend surface,
read [the frontend implementation contract](../docs/FRONTEND-CONTRACT.md),
[DESIGN.md](../DESIGN.md) and the affected shell/feature contracts linked there.

Apply the shared shell → feature → UI-kit ownership, state lifetime, responsiveness,
accessibility and verification rules. Do not treat Integrations as the only consumer or claim
all features are complete from one panel's evidence. Whole-product work requires a result
and limit for every catalog feature. The same contract covers native DOM UI in `lib/`.

Every slice under `frontend/slices/` must have an entry in `frontend/slices/feature-contracts.ts`,
an `index.ts`/`index.tsx` barrel, and at least one colocated unit test, and must pass
`bun run check:features` (`feature.boundaries.json`). Use `<ConfirmDialog>` (from
`@/features/appshell`) instead of `window.confirm()`, use `featureFetch()` (from `@/lib/os-api`)
for normalized 401/403/JSON handling, and avoid single-line minification (>400 chars/line).
For independently updatable features outside the core build, see [`docs/MODULAR-FEATURES.md`](../docs/MODULAR-FEATURES.md).

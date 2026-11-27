# 2026-11-27 — Image Editor canvas studio: components wired into the app

## What was broken

The 2026-11-24 refactor landed every studio component (`ImageEditorTopBar`, `Toolbar`,
`Stage`, `CropOverlay`, `Inspector`, `Adjustments`, `Layers`, `ExportModal`) plus the
`image-editor-*` model modules, but `ImageEditorApp.svelte` was never rewired. The app still
rendered the earlier three-slider panel and imported `creative-state.ts`, so the shell opened
a simple preview, not the studio. The delegated thread died on an upstream provider quota
("Individual quota reached") mid-task, and the partial files were committed without the
assembly step.

## What changed

- `ImageEditorApp.svelte` now composes TopBar, Toolbar, Stage, Inspector, and ExportModal and
  keeps the `initialPath` prop plus the `data-image-loaded` attribute.
- `image-editor-session.svelte.ts` owns runes state; `image-editor-controller.svelte.ts` owns
  the document/history actions; `image-editor-layer-ops.ts` owns layer add/move/patch/remove;
  `image-editor-keys.ts` owns the keyboard map (tool shortcuts, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`).
  This keeps every touched file inside the 220-line architecture ratchet.
- `ImageEditorStage.svelte` reports drag start through `onBeginMove` so a move is one history
  entry, not one per pointer sample.
- `ImageEditorApp.css` defines the responsive grid (rail, options, stage, inspector) that
  collapses to a single column below 960px.
- `docs/SVELTE-IMPLEMENTATION.md` image-editor row now describes the shipped studio instead of
  the three-slider panel.

## Verification

- `cd frontend/svelte && bun run check && bun run test && bun run build`
- `node scripts/check-architecture.mjs`, `node scripts/check-features.mjs`, `node scripts/check-contrast.mjs`
- `cd frontend/svelte && node tests/creative-image-editor.browser.mjs` (new journey: open a host
  image, apply a preset, drag an adjustment, add a layer, export to the VPS path, no horizontal
  overflow at 390px) and the existing `tests/browser.mjs`.

## Rebased onto current main (2026-11-27)

Merged `origin/main` (`17353589`, the #375 Finder copy path and MCP toolCount fix) into the
branch, so PR #380 is no longer `BEHIND`. Re-ran the full gate on the merged tree:

- `bun run check` → 0 errors, 3 warnings (same pre-existing warnings as `main`)
- `bun run test` → 381 tests, 379 pass, the same 2 `cutover-drill` `cargo` ENOENT failures
  that also fail on `main` (no Rust toolchain on this host)
- `bun run build` → `Wrote site to "build"`
- `node scripts/check-architecture.mjs`, `check-features.mjs`, `check-contrast.mjs` → all healthy
- `node tests/creative-image-editor.browser.mjs` → PASS (load, Noir preset, brightness drag,
  3 layers, canvas, VPS export, no horizontal overflow at 390px)
- `node tests/browser.mjs` → PASS (33/33 slices at 320/390/1440, light and dark)

Screenshot: `/tmp/opencode/image-editor-studio.png`

## Limits

- The synthetic browser fixture serves one flat PNG. Brush, eraser, text, shape, and crop
  pointer gestures are covered by unit tests on the model functions, not by a browser pointer
  journey.
- The 2 remaining `bun run test` failures are `scripts/cutover-drill.mjs` needing `cargo`, which
  this host does not have. They fail identically on `main`.

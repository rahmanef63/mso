# 2026-11-28 — Image Editor undo history: half-open edits discarded

## What was broken

`createImageEditorActions` tracked slider drags and overlay moves with a `preEdit`
snapshot taken in `beginEdit()`. A discrete action (`commit()`) pushed the current
document onto the undo stack but never cleared `preEdit`, so the snapshot taken
*before* that action stayed live. The next `endEdit()` then pushed that stale
snapshot, and the following undo jumped back two steps.

Reproduced in the real browser: apply the Noir preset, drag Brightness to 180,
release, then undo once. The editor landed on `Original` (the state before Noir)
instead of `Noir` with the drag reverted. A press on a text overlay that never
dragged leaked the same snapshot, because `handleCanvasUp` only called
`onCommitMove()` when the pointer had actually moved.

## What changed

- `commit()` clears `preEdit` before pushing history, so a discrete action closes
  any half-open slider edit.
- `commitMove(moved)` takes the drag outcome; `ImageEditorStage` now always reports
  it on pointer up, so a press without movement discards the snapshot instead of
  leaving it armed.
- `tests/creative-image-editor.browser.mjs` adds the regression: press an overlay
  without dragging, apply Noir, drag Brightness to 180, then assert one undo lands
  on Noir/98 and redo returns 180. The new assertions fail on the unfixed code and
  pass with the fix.

## Verification

- `cd frontend/svelte && bun run check` → 0 errors, 0 warnings
- `cd frontend/svelte && bun run test` → 390 tests, 390 pass
- `cd frontend/svelte && bun run build` → `Wrote site to "build"`
- `node tests/creative-image-editor.browser.mjs` → PASS
- `bun run svelte:e2e` from the repo root → all journeys PASS, including 33/33 slices
- `node scripts/check-architecture.mjs` → healthy (filesOver220 back at 47/47;
  `image-editor-controller.svelte.ts` stays at 219 lines)
- `node scripts/check-features.mjs`, `check-contrast.mjs`, `check-docs.mjs` → healthy
- Live tool probe through the built app: open image, brush stroke, text overlay,
  shape drag, Ctrl+Z / Ctrl+Shift+Z, 1:1 crop (canvas 800x800), 100% zoom wider than
  fit, eraser drag, vignette repaint, export dialog, no overflow at 390px, no page
  errors (13/13)

Screenshot: `/tmp/opencode/image-editor-tools.png`

## Limits

- `bun run test` needs `$HOME/.cargo/bin` on `PATH` here; without it the two
  `cutover-drill` cargo tests fail with ENOENT on this host only.
- The synthetic fixture serves one flat PNG, so brush, eraser, text and shape
  gestures are covered by the probe journey plus model unit tests, not by a
  pixel-level assertion.

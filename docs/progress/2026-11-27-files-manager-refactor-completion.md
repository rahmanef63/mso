# Files Manager refactor: finish the interrupted follow-up

The "Refactor Files Manager UX (Neon)" thread stopped on model quota after it had
already committed `30779418` (grid view, quick look, upload bar, zip panel, entry
menu). That commit reached `main` through `8f1a2794`, so the feature work is not in
question here. Two deliverables from the same brief never arrived.

## What was missing

1. `frontend/svelte/tests/files-refactor.test.ts` did not exist. The brief asked for
   it explicitly, and every file the refactor added (extended API, batch API, entry
   metadata, markdown blocks, upload, zip, usage) had zero unit coverage.
2. The new components introduced three `svelte-check` warnings: a `div` with a
   keydown handler and no role, an inline 433-char shell line, and `winId` captured
   by value in the actions dependency object.

## Changes

- `FilesEntryMenu.svelte`: the Escape handler moves onto the trigger button; the
  wrapper stays non-interactive. Warning count for the file drops to zero without
  adding an ARIA role that would claim a composite widget the markup does not build.
- `FilesManager.svelte`: named `closeMenus` / `onShellKeydown` handlers replace the
  one-line shell element, so no line exceeds 400 chars. `winId` is exposed to the
  actions object through a getter, matching the existing `controller` and
  `selectedNames` accessors, so a window rebind is not frozen at mount.
- `tests/files-refactor.test.ts`: eight tests covering sort and filter ordering
  (folders first under every field and direction, no input mutation), media and
  badge classification, markdown block parsing without HTML, raw and zip URL
  contracts including traversal and empty-selection rejection, disk and folder
  usage shapes with fail-closed parsing, multipart upload ordering and progress,
  batch copy/delete/rename with per-entry failure isolation and abort, plus the
  repo UI gates over the whole `files/` directory.

## Verification

- `cd frontend/svelte && bun run check` reports 0 errors and 0 warnings.
- `node --experimental-strip-types --test tests/files-*.test.ts` reports 22/22.
- `bun run build` succeeds.
- `node tests/browser.mjs` passes, including the Files Search/Copy/Move journey.
- `node tests/os-shell-matrix.mjs` passes for all five shells (finder, explorer,
  ios-files, android-files, dashboard) with both Files windows preserved.
- `node scripts/check-features.mjs`, `check-architecture.mjs` and `check-contrast.mjs`
  stay healthy within their ratchets, and `audit.mjs --dir=frontend/svelte` is clean.

## Not covered

The WebKit leg of `os-shell-matrix.mjs` is blocked on this host because the
Playwright WebKit build is not installed; Chromium results are the evidence above.

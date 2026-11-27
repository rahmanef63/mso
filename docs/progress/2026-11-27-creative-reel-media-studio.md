# 2026-11-27 creative reel + media studio recovery

## Stopped work

The T3 delegated thread "Refactor Reel Editor & Media Studio (Neon)" died on
`Individual quota reached` from the antigravity provider, not on a code fault.
Its follow-up recovery thread then died at an unrelated tool crash
(`Internal error: Failed to execute statement`) while dumping the transcript.

The refactor itself had already landed on `main` in
`ed047fee feat(svelte/creative): reel editor timeline, asset bin, inspector, and media studio models`,
so the branch carried zero commits against `main` and nothing was left to re-port.

## Why the recovery still mattered

Re-reading the original brief against the shipped code found one live regression
that the passing unit suite never covered, because the suite asserts model
functions, not DOM wiring:

- `MediaStudioApp.svelte` bound `durationInput` to `<input type="number">`.
  Svelte 5 `bind:value` coerces that state to a **number**, so
  `durationInput.trim()` threw `Uncaught TypeError: ...trim is not a function`.
  The submitted handler aborted before `preventDefault` side effects, and the
  "Add asset" button silently did nothing. Browser evidence before the fix:
  header stayed at `0 ASSETS`, no notice rendered.

## Fix

- `studio-model.ts`: new `parseDurationInput(raw: string | number | null | undefined)`
  which normalizes before validating and rejects `NaN`, negatives and blanks.
- `MediaStudioApp.svelte`: duration parsed through that helper; the state is
  typed `number | string` to admit both shapes `bind:value` can produce.
- `ReelAssetBinTab.svelte`: same latent mismatch (state declared `"5"`, rewritten
  as a string after submit). Reseed with `5` and widen the state type.
- `creative-reel-refactor.test.ts`: regression test pinning helper behaviour for
  number, numeric string, zero, blank, `null`, `undefined`, junk, negative and `NaN`.

## Verification

- `node --experimental-strip-types --test tests/creative-reel-refactor.test.ts` -> 8/8 pass.
- `cd frontend/svelte && bun run check` -> 0 errors (3 pre-existing a11y warnings in
  Files manager, outside this scope).
- `cd frontend/svelte && bun run test` -> 367 pass, 2 fail. Both failures are
  `cutover-drill` spawning `cargo`, which is not installed on this host; unchanged
  from `main`.
- `cd frontend/svelte && bun run build` -> clean.
- `node scripts/check-features.mjs`, `node scripts/check-architecture.mjs`,
  `node scripts/check-docs.mjs`, `node scripts/check-contrast.mjs` -> healthy.

## Browser evidence (demo shell, `?demo=1`)

Reel Editor at `/reel-editor`:

- stage renders with `aria-label="Stage preview (1:1 Square)"` after switching ratio,
  computed `aspect-ratio` is `1 / 1`;
- 3 seed clips and 2 captions render; Split, Duplicate, + Caption, Play, Pause all
  mutate state (`Clip 1/5: Opening Hook`, timecode advanced to `00:01.0 / 00:14.0`);
- audio lane exposes path, volume 80% and Mute; no horizontal overflow at 1280px.

Media Studio at `/media-studio`:

- before fix: "Add asset" threw `TypeError: ...trim is not a function`;
- after fix: adding `~/media/clip.mp4` with duration 12 yields
  `1 ASSET / TOTAL 00:12 (12S) / VID 1` and the inspector shows kind, queue slot
  1/1, offset `00:00 - 00:05` and note/tag controls;
- adding an image with the default duration yields `3 ASSETS / IMG 2`;
- VPS browser lists the demo home, navigates into `projects`, and correctly reports
  "No folders or image/video/audio files in this directory".

## Remaining work

- Rust toolchain is absent on this host, so `frontend/svelte/tests/cutover-drill.test.ts`
  and the `gate:smart` step that runs it cannot go green locally. CI has `cargo`;
  the two failures are not caused by this change.
- Three pre-existing Svelte a11y warnings live in `FilesManager.svelte` and
  `FilesEntryMenu.svelte`; out of scope for this thread.
- The legacy Next.js reel editor carried an AI edit panel, drag-to-trim on the
  timeline, draft autosave and a render/export overlay. The Svelte port has the
  timeline, captions, transitions, filters, inspector and JSON/snapshot export,
  but not the AI panel or draft autosave. Those need a separate decision because
  they depend on agent APIs and workflow persistence rather than purely local UI.

# 2026-11-28 reel editor drag-to-trim

## Context

The delegated thread "Refactor Reel Editor & Media Studio (Neon)" died on a provider
quota error (`Individual quota reached`), not on a code fault. Its recovery thread
landed the fix as PR #379 (`fix(svelte/creative): Media Studio asset form threw on
number-bound duration`), which is merged on `main`.

That recovery recorded one explicit unfinished item: the legacy reel editor had
drag-to-trim on the timeline, and the Svelte port only exposed trim through the
inspector's numeric fields. This change closes that gap.

## Change

- `reel-trim.ts`: new `trimFromDrag({ edge, deltaPx, widthPx, durationSec, trimInSec, trimOutSec })`.
  Pixel deltas map to seconds using the rendered clip width, so the drag is 1:1 with
  the block the user is holding. It only maps units; the existing `patchClipTrim`
  keeps owning the clamp (`durationSec - 0.5` ceiling, non-negative floors).
- `ReelTrimHandle.svelte`: pointer-capture handle rendered on both ends of each
  timeline clip. It commits on pointerup, supports `ArrowLeft`/`ArrowRight` at 0.5s
  per press for keyboard users, and widens to a 44px target on coarse pointers.
- `ReelTimeline.svelte` / `ReelEditorApp.svelte`: the new `onTrimCommit` prop is
  wired to the same `handlePatchTrim` the inspector already used, so drag and
  numeric entry share one history stack and undo path.
- `reel-ops.ts`: reverted to its previous size. The drag mapper lives in its own
  module instead of growing an already 198-line file past the architecture ratchet.

## Verification

- `node --experimental-strip-types --test tests/creative-reel-refactor.test.ts tests/creative-reel-trim.test.ts`
  -> 9/9 pass.
- `node --experimental-strip-types --test tests/*.test.ts` -> 391 tests, 389 pass,
  2 fail. Both failures are `cutover-drill.test.ts` spawning `cargo`, which is not
  installed on this host; identical to the `main` baseline.
- `svelte-check --tsconfig ./tsconfig.json` -> 0 errors, 0 warnings.
- `bun run build` -> clean.
- `node scripts/check-architecture.mjs`, `check-features.mjs`, `check-docs.mjs`,
  `check-contrast.mjs` -> healthy within ratchets.
- `node tests/creative-reel-editor.browser.mjs` (now part of `test:browser`) ->
  `PASS Reel Editor: drag trim 4s -> 3.1s trimmed, keyboard trim -> 2.1s trimmed,
  no overflow at 390px`. Screenshot: `/tmp/opencode/reel-editor-trim.png`.

## Remaining work

- `cargo` is still absent locally, so `cutover-drill.test.ts` cannot go green here.
  CI has the Rust toolchain.
- The legacy Next.js reel editor also carried an AI edit panel and draft autosave.
  Both depend on agent APIs and workflow persistence, not on purely local UI, so
  they stay out of this change and need their own decision.

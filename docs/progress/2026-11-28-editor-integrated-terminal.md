# 2026-11-28 — Code Editor: restore the integrated terminal that the legacy IDE had

## What was missing

The Svelte port of the code editor lost the legacy Next.js slice's integrated terminal
(`0c324015~1:frontend/slices/code-editor/components/integrated-terminal.tsx`, mounted from
`app.tsx` behind a `terminalOpen` toggle in `editor-toolbar.tsx`).

The gap was invisible in review because two things already claimed the feature existed:

- `docs/TROUBLESHOOTING.md` documents a "Code editor Terminal button" and how its `cwd`
  resolution fails outside allowed roots.
- The earlier thread's spec listed a bottom console panel and only the *Run* half of it was
  removed in #382, because `/api/v1/editor/exec` is the headless image-doc registry rather
  than a shell.

Nothing in `frontend/svelte/src/lib/editor/` referenced the terminal slice, so the editor
window had no console at all.

## Why a terminal and not a repaired Run button

The honest console already exists and is already authorized end to end:

| Layer | Fact |
|---|---|
| Host routes | `/api/v1/term/open`, `/input`, `/resize`, `/close`, `/stream` |
| Svelte proxy allowlist | `frontend/svelte/tooling/backend-proxy.mjs:59-63` |
| Rust shell allowlist | `rust-shell/crates/mso-shell-core/src/proxy.rs:36-39, 96` |
| Client | `frontend/svelte/src/lib/terminal/*` (PTY controller, ANSI-safe renderer, keybar) |

`/api/v1/exec/run` by contrast is owner-gated host RCE and deliberately unlisted in both
proxies. Reusing the PTY needed no new route, no new allowlist entry and no new audit row.

## Change

- `EditorTerminalDrawer.svelte` (new, 63 lines) — bottom drawer that renders the terminal
  slice's `TerminalPane` with the editor's working directory and surfaces its live status.
- `EditorToolbar.svelte` — `Terminal` toggle with `aria-pressed`, next to Wrap/Find/Line.
- `CodeEditorApp.svelte` — `terminalOpen` state, `terminalCwd` derived from
  `parentDir(activeTab.path ?? pathInput)` with `~` fallback, drawer mounted below the
  workspace split so the status bar stays last.
- `frontend/svelte/tests/editor-refactor.test.ts` — new guard asserting the drawer exists,
  is mounted, reuses `TerminalPane`, and that none of the three editor files calls `fetch`
  directly (the terminal slice stays the single owner of PTY transport).
- `frontend/svelte/tests/_os-matrix-servers.mjs` — the fixture backend now answers
  `/api/v1/term/open|input|resize|close|stream`. The drawer opens a PTY on mount, so the
  old fixture 404ed and the multi-window journey failed on a console error rather than on
  the layout it was written to check.
- `_os-matrix-shells.mjs` — the multi-window journey now opens the terminal drawer and
  asserts it stays inside `ide-root` and `win-body`, that the prompt is not clipped, and
  that the drawer keeps at least 120px. This is the regression that the earlier thread hit
  as "needs 276px, gets 171px".

## Verification

```sh
cd frontend/svelte && node --experimental-strip-types --test tests/editor-refactor.test.ts tests/editor-docs.test.ts
cd frontend/svelte && ./node_modules/.bin/svelte-check --tsconfig ./tsconfig.json   # 0 errors
cd frontend/svelte && ./node_modules/.bin/vite build                               # writes build/
node scripts/check-features.mjs        # healthy within ratchets
node scripts/check-architecture.mjs    # healthy within ratchets
node scripts/check-proxy-parity.mjs    # both allowlists describe the same surface
node scripts/check-contrast.mjs        # 0 WCAG AA failures, both themes
node scripts/check-docs.mjs            # docs current
```

Editor slice tests: 13/13 pass.

## Remaining, not done here

- Full `bun run test` still reports two failures on this host only:
  `cutover-drill` tests call `spawnSync cargo`, and this machine has no Rust toolchain.
  Pre-existing and unrelated to the editor.
- The drawer is a single PTY, not the terminal slice's multi-tab workspace. A second tab
  belongs to the Terminal window, which already owns that surface; keeping one shell here
  preserves the `MAX_TABS` budget.

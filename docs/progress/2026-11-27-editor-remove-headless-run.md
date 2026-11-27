# 2026-11-27 — Code Editor: remove the Run console that could never work

## What was broken

`be7a085a` gave the Svelte code editor a Run button and an Output Console drawer wired to
`POST /api/v1/editor/exec`. That endpoint is not a script runner. It is the **headless
image-editor doc registry** (`lib/image-editor/server.ts`): it JSON-parses the target file,
runs doc commands (`doc.resize`, layer ops) against a canvas document, and writes
`JSON.stringify(doc)` back.

The editor sent `{ path, language, content, cmd }` and no `commands`, so both real outcomes
were wrong:

| Active buffer | What the handler did | What the UI showed |
|---|---|---|
| existing `.ts` / `.py` / `.md` | `JSON.parse` fails, so `400 "… exists but is not JSON — refusing to overwrite"` | `Exit 400`, no stdout |
| new/unsaved buffer path | seeded `blankDoc()` (`{"width":1080,"height":1080,"bg":"#ffffff","layers":[…]}`) and wrote it **into the source path** | `Exit 0`, empty output |

Verified against the real module:

```text
existing .ts file JSON-parses? false
=> handler returns 400 'exists but is not JSON — refusing to overwrite'
missing path now contains: {"width":1080,"height":1080,"bg":"#ffffff","layers":[…]
isDoc seeded into a .ts path? true
```

So the control was dead for real files and actively destructive for new ones. It also
violated the repo rule that every interactive element has real behaviour.

`Run` could not be repaired by pointing it at `POST /api/v1/exec/run` either: that route is
owner-gated host RCE, deliberately **unlisted** in both proxies
(`frontend/svelte/tooling/backend-proxy.mjs`, `rust-shell/crates/mso-shell-core/src/proxy.rs`)
and returns `404` under `mso-shell-host`. Shipping a shell button in the editor would mean
widening both allowlists for a convenience action the Terminal slice already owns.

## Change

Deleted the capability instead of faking it:

- `frontend/svelte/src/lib/editor/editor-exec.ts` (removed) — the `runEditorFile` /
  `defaultRunCommand` client. `editor-api.ts` no longer re-exports it.
- `frontend/svelte/src/lib/editor/RunOutputDrawer.svelte` (removed) — the console drawer.
- `CodeEditorApp.svelte` — dropped `consoleOpen`, `runCommand`, `running`, `runResult`,
  `runAbort`, `handleRunFile`, the unmount abort, and the `aria-busy`/drawer wiring.
- `EditorToolbar.svelte` — dropped the `Run` and `Console` buttons plus their props.
- `frontend/svelte/tests/editor-refactor.test.ts` — replaced the endpoint test with a guard
  test asserting no editor slice file calls `/api/v1/editor/exec` or `/api/v1/exec/run`.

The image-editor doc endpoint itself is untouched: `claude-skills/mso-image-editor/`,
`mso list cmds`, and the headless API keep working. Only the code editor stops claiming it
is a script runner.

## Verification

```sh
cd frontend/svelte && node --experimental-strip-types --test tests/editor-refactor.test.ts tests/editor-docs.test.ts
cd frontend/svelte && npx svelte-check --tsconfig ./tsconfig.json   # 0 errors
cd frontend/svelte && npx vite build                                # writes build/
node scripts/check-features.mjs        # healthy within ratchets
node scripts/check-architecture.mjs    # healthy within ratchets
node scripts/check-docs.mjs            # docs current
node scripts/check-contrast.mjs        # 0 WCAG AA failures
node scripts/check-proxy-parity.mjs    # both allowlists describe the same surface
npx tsc --noEmit                       # clean
```

Editor slice test file: 6/6 pass, including the new guard.

## Remaining, not done here

- `docs/CHANGELOG.md:35` still lists "run drawer" for `be7a085a`. That file is generated on
  `main` by `bun run ship`; do not hand-edit it on a PR branch.
- If an owner-only in-editor shell is wanted later, the honest path is a dedicated editor
  run route with its own audit row and explicit allowlist entries on both proxies, plus the
  same destructive-command guard as `lib/host/exec.ts`. Not a reuse of `editor/exec`.

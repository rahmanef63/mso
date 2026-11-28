# Browser backup for the v2 shell: four keys, not the v1 prefix sweep

v1 exported everything its prefix rule matched (`mso:`, `mso.`, `sv:`, `alfa.` plus a
short extras list) — the window layout, Playbooks, Agents, Automations, the app registry,
widgets, wallpapers. All of that had a reader in the React shell
(`frontend/slices/appshell/lib/local-state.ts`). The Svelte cutover deleted those readers
along with the React slices, but the backup UI went with them, so a v2 browser had no way
to save or restore the little bit it still keeps locally.

Re-running the v1 prefix rule against v2 would have been worse than omitting the feature:
it would export keys nothing reads, and it would happily import `mso.device.id`, which is
the second authentication factor. Imported, that id turns "the backup file leaked" into
"the attacker skips device approval".

## What shipped

`frontend/svelte/src/lib/settings/browser-backup.ts` is a pure module with an explicit
allowlist of the four keys the v2 shell actually reads back:

| Key | Reader | Validation |
| --- | --- | --- |
| `sv:shell` | `readLocalShellPrefs` (`shell-prefs-store.ts`) | JSON object, normalized through `normalizeShellPrefs`, rejected when no known field is usable |
| `mso.shell.accent` | `WorkspaceRoot.svelte` `readStored` | `#rrggbb`, lowercased |
| `mso.shell.boldText` | same | exactly `"true"` or `"false"` |
| `mso.shell.textSize` | same | integer 0..100 |

`BrowserBackupCard.svelte` renders it inside Settings → System & Storage, owner only, and
`SystemSection.svelte` mounts it. Everything is client-local: no endpoint, no logging of
values, and the file never leaves the browser except through the user's own download.

Behaviour that is deliberate rather than incidental:

- **No prefix wildcard.** `sv:dock`, `alfa.*`, `mso:quicklinks` and `appshell:layout` have
  no v2 reader, so they are counted as skipped and not restored.
- **Denied keys are named.** `mso.device.id` and `mso:demo-fs` appear in the confirm
  dialog's "not restored" summary with a security reason, instead of vanishing silently.
- **The legacy v1 envelope is still accepted** (`kind: "mso.local-state"`, `schema: 1`),
  but only its four allowlisted fields are lifted out. The dialog says outright that older
  backups may also list Playbooks, Agents, Automations or window layouts and that this
  build has no reader for them, so nobody is told those came back.
- **Nothing is deleted that the file did not provide.** v1's restore replaced the whole
  owned set; that is not safe here, because the four keys are appearance state a user may
  have changed in a different tab.
- **Writes are all-or-nothing.** Previous values are captured before the first
  `setItem`; a quota or blocked-storage failure restores them and reports
  `rolledBack: false` only when even the rollback failed.
- **Reload only after a successful restore**, and only through the explicit confirm
  button. A cancellation clears the pending state.
- **Malformed, foreign, newer-schema and oversized (`>64 KiB`) files are refused whole**,
  and the schema error tells the user to update MSO rather than half-applying.

## Verification

    cd frontend/svelte && node --experimental-strip-types --test tests/browser-backup.test.ts
    # tests 10, pass 10, fail 0

Covered: allowlist exactness, `sv:shell` normalization and strict per-field validation,
out-of-range/malformed appearance values, non-string JSON values, export filtering with
corrupt stored rows, the legacy v1 envelope with denied and unknown keys, partial-invalid
imports, unsupported schema / wrong kind / malformed / oversized refusal, rollback on a
mid-write quota failure, and the guarantee that restore never deletes absent keys.

    node scripts/check-architecture.mjs   # filesOver220 47/47, filesOver500 0/0, healthy
    node scripts/check-features.mjs       # rawLocalStorageSlices 1/12, healthy
    node scripts/check-docs.mjs           # docs: current
    cd frontend/svelte && npx svelte-check --tsconfig ./tsconfig.json
    # svelte-check found 0 errors and 0 warnings

## Not done here

- No browser round-trip. The disposable browser fixture the brief asks for needs
  `bun install` in `frontend/svelte`, which was skipped: this host had under 3 GiB of
  available RAM at points during the work, and no build/install was started for that
  reason. `node_modules` was borrowed from an existing worktree on the same Svelte and
  Kit versions for `svelte-check` only.
- No `bun run gate:smart` / `pr:local`: both need the install above.
- Server-synced preferences (theme, wallpaper, accent through `/api/prefs`) are untouched
  and out of scope; the card only covers what has no server copy.

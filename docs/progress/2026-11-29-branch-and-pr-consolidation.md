# Branch and PR consolidation - 2026-11-29

Everything that was open or dangling after #400/#401. This is the tracking list: what
landed, what was a stale snapshot, and what is genuinely unfinished.

## Landed on main

| PR | Squash | What |
| --- | --- | --- |
| #400 | `06bcf9e` | Svelte v2 browser backup (four allowlisted keys) |
| #401 | `550c2ae` | Changelog entry for #400, which unblocked Verify |

Main head when this was written: `550c2ae0`.

## The five `sync(manef)` drafts: close, do not merge

All five are cross-fork reconciliation drafts from `official-manef`, all marked draft, and
their own bodies say "Do not merge blindly; verify each changed file, preserve current main
behavior and security, discard stale or already-equivalent changes". Verified, and every one
of them would move main backwards.

| PR | Branch | Verdict |
| --- | --- | --- |
| #396 | `main` | Re-adds the deleted Next.js demo (`demo/app/layout.tsx`, `demo/next.config.mjs`, `vercel.json`, `docs/DEMO-FORK.md`). 10 resurrected paths. |
| #398 | `demo/static-upstream-sync` | Same 10 resurrected paths as #396. |
| #399 | `agent/152-projects` | Reverts `lib/infra/convex-project-link.ts` to a loop-variable `fs` read that made Turbopack trace the whole project; main carries the later literal-path fix. Conflicting, 513 commits behind. |
| #397 | `agent/152-convex-provider` | Would delete `teamToken` from `CONVEX_SECRET_KEYS` and drop the `mso-password` bare-hostname validation from `catalog.ts`. 513 behind. |
| #395 | `agent/mso-f1712a053a15` | 87 of its 100 files are React/Next files that the Svelte cutover deleted. Merging it restores `frontend/slices/**/*.tsx` and `app/os-root.tsx`. Its 12/12 green checks do not mean the change is correct. |

The pattern is the same in all five: they were generated from a fork that never took the
Svelte cutover or the later security hardening, so "newer branch" is not "newer code".

## The 24 remote / 42 local branches

Verified by comparing file *content* against `origin/main`, not by ancestry (squash rewrites
SHAs, so ancestry says "not merged" for work that plainly landed).

**Fully contained in main (0 differing files):**

- `t3/refactor-files-manager-ux`, `resume/dedup-terminal`,
  `fix/ux-mcp-toolset-count-finder-copy-path-20261127`,
  `fix/baseline-security-headers-zap`
- `fix/changelog-main-2b76dbb2-20261127`, `docs/changelog-refresh-1735358901-20261127`
- `t3/resume-failed-mso-work`, `t3/resume-codex-refactor`,
  `t3/refactor-image-editor-studio-1`
- 15 more already ancestors of main

**Pre-#368 Apple shell snapshots.** `feat/apple-os-shell-2.0` and its satellites
(`t3/apple-settings-files-ui`, `t3/ios-ipados-shell-polish`, `t3/wallpaper-accent-ui-polish`,
`t3/macos-shell-icons-control-center`, `t3/liquid-glass-apple-sheet-toast`,
`t3/wire-rust-apple-shell-parity`, `feat/apple-os-shell-1to1`, `release/apple-shell-v2-lara`)
are older than main, not ahead of it. Proof: main's `app-icons.ts` has the `t3` dock icon and
`WorkspaceRoot.svelte` pins `t3` in the dock; those branches do not. The Apple shell landed
as PR #368 (`c0c70f36`, 2026-11-26) and main has carried it forward since.

**Genuinely unique, small:**

- `t3/apple-review-qa-harness` - independent Apple shell acceptance harness (`scripts/qa/*`).
  Not on main. Keep or redo; it is test-only and does not affect shipped behaviour.
- `t3/finder-details-filter-actions`, `t3/ipad-settings-files`,
  `t3/iphone-shell-files-monitor` - Finder/iPhone fix commits whose subjects are absent from
  main, but whose target files main has since rewritten. Needs a per-hunk review, not a merge.
- `tmp/integration-check-20261128` - a scratch integration branch, superseded by main.

## Open work after consolidation

Tracked here so it is not lost again:

1. **Decide the fate of `t3/apple-review-qa-harness`.** Test-only. Either land it or drop it.
2. **Per-hunk review** of the three Finder/iPhone fix branches above against main's current
   `FilesManager.svelte`. They may already be equivalent after #368.
3. **Close the five sync drafts** with a note, so they stop appearing as unread work.
4. **Prune merged local and remote branches** once the above is settled.
5. **Deploy.** `mso update --rebuild` has not been run; main is ahead of the live cockpit.

## Method note

`git cherry` and `git merge-base --is-ancestor` both report "not merged" for squash-merged
work, which is why 28 branches looked unmerged. Comparing blob SHAs per file
(`git rev-parse <branch>:<path>` vs `origin/main:<path>`) is the only test that survives
squash, and it is what this triage is based on.

## Cleanup actually executed (2026-11-29)

Remote branches 24 to 14. Deleted only after proving each one adds nothing main lacks.

**Deleted, 10 proven ancestors of main** (the `agent/nightly/mso/*` fleet plus one
already-squashed fix):

`alert-210-stacktrace-callers`, `codeql-210-211-http-shim`, `dependabot-green-train`,
`gitignore-results-rebase`, `native-host-svelte-launcher`, `openclaw-install-dedupe-209`,
`release-fixture-changelog-rebase`, `semgrep-case-parser-branch-protection`,
`fix/oauth-cross-origin-handoff-20261126`, `fix/v2-settings-update-parity-20261128`

**Deleted, 3 with zero differing files** against main: `t3/refactor-files-manager-ux`,
`fix/ux-mcp-toolset-count-finder-copy-path-20261127`, `docs/branch-pr-consolidation`.

**Kept, still has unique content:** `release/apple-shell-v2-lara` (13 files),
`review/apple-shell-on-f4347890` (2), `t3/refactor-code-editor-ide-1` (5),
`t3/refactor-image-editor-studio-1` (5), `t3/refactor-image-editor-studio-3`,
`t3/refactor-reel-media-studio-1` (1), `fix/348-hermetic-release-fixture`,
`agent/nightly/mso/baseline-header-smoke`, `agent/nightly/mso/alert-210-managedapps`,
`agent/nightly/mso/ignore-playwright-results`, plus two single-line changelog branches.

**Local branches left alone.** 34 of them are checked out in worktrees under
`~/.t3/worktrees` and `~/.cache/mso-worktrees`, which belong to other T3 threads. Deleting
those would break live sessions, so local pruning needs a separate, deliberate pass per
worktree.

## The changelog guard cannot catch itself

`gen-changelog.mjs` defers on any non-main branch by design, so `--check` only ever runs on
main after a squash. A docs-only PR therefore merges green and breaks main's `bun run check`
afterwards. This happened three times (#400, #402, and the fix for both). `bun run ship`
regenerates; a plain squash-merge does not.

If that keeps biting, the cheapest durable fix is a `main`-only post-merge step (or a
pre-push regeneration on main), not a stricter PR check that would defer anyway.

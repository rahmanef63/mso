# Panel contract: the rules a TUI change must not break

Written after three batches of panel work, because every one of them re-learned the same lessons the hard
way. This is not a tour of the code. It is the list of invariants that have already been broken once, with
the failure each one caused, so the next change can be checked against them instead of discovering them.

Read this before touching anything under `scripts/mso-agent-*`.

## 1. Defaults must be byte-identical

Any change that alters rendered output ships behind a default that reproduces today exactly. Prove it with a
fixture captured **before** the change, not by reasoning about it.

This is not caution theatre. Two features in this track nearly shipped a silently different footer and
transcript, and both were caught only because a byte fixture existed. A user who never asked for a feature
must not receive it.

Where it applies: `session.verbosity` (footer density, default `high`), `session.grouping` (tool
collapsing, default `none`), `tabs.indicators` (default `numbers`), `tabs.scope` (default `global`),
`mouse` (default `on`), `scroll.speed` (default `3`).

## 2. A setting with no consumer must not exist

`scripts/mso-agent-settings-entries.mjs` carries this rule at the top, and eleven settings passed it while
around a dozen candidates were refused. A registry listing switches that do nothing is worse than a short
registry, because it teaches the user that the settings panel is decoration.

The refusals, recorded so they are not re-litigated:

| Refused | Why |
|---|---|
| `diffs.wrap`, `diffs.view`, `diffs.tree`, `diffs.single` | every diff line is clipped by `fitCells`; the pane is 30 to 50 columns so a split is unreadable; the `files` pane already lists files; the pane shows one diff |
| sidebar slot `limit` | the context pane already shows `used/limit` with a bar, and no provider quota exists on a session |
| sidebar slot `footer` | `chromeLines` already renders a footer |
| image preview | the renderer is a line painter with no graphics protocol, and images carry no dimensions |
| `attention.volume` | BEL has no volume parameter |
| desktop notifications | OSC 777 corrupts frames on terminals that lack it |
| `scroll.acceleration` | no velocity exists to measure |

## 3. `updatedAt` is not an activity signal, and never was

`docs/AGENT-ACTIVITY-SIGNAL.md` is the full audit. The short version: `persistSession` runs at turn
**completion**, so a turn that just ended marks an idle session as working for sixty seconds, while a turn
streaming for three minutes still carries the previous timestamp and reads as idle. Both directions are
wrong, and the second is the common one.

The fix is server side: `turnStartedAt` written at turn start, cleared in `finally`, surfaced as
`turnActive`. Until a view can read `turnActive` or an explicit `status`, it renders **unknown**, not a
guess. `needsAttention` follows the same rule, which is why `/tabs next` reports `no sessions need
attention` rather than cycling.

## 4. One layout source, or the hit test drifts

`tabLayout` produces the segments; `tabRow`, `tabRailLines` and `tabAtPoint` all consume them. Splitting
this is how a click target stops agreeing with the painted cell, which already happened once.

The same rule now applies to geometry: `mso-agent-panel-geometry.mjs` owns every number that decides how
much terminal a user sees. Adding layout arithmetic to the paint loop is how that file reached 225 lines
and how two features could have disagreed about the transcript width.

## 5. A repaint must never create scrollback

The composer and the panel both assert this. Every repaint is a diff in place, never an append, and a
shrink clears the released rows while moving the cursor up rather than leaving them.

The bug that proved it matters: `reserveComposerRows` returned early when the new height was not larger, so
the reservation ratcheted up and never came down. Pressing Esc closed the completion menu but the prompt
never moved back up, and the gap sat there for the rest of the session.

## 6. Suspension must leave, not merely detach

A line-oriented prompt needs the terminal. `createPanelSuspension` leaves the alternate screen, turns mouse
reporting off and stops the input hook. Detaching the stream sink alone is not enough: the prompt was
painted into the alternate buffer and the next repaint erased it, so the user answered a question that had
already vanished.

Two paths matter and both are tested: resume must not resurrect mouse when the setting is off, and a prompt
that throws must still repaint.

## 7. Errors are never collapsed, hidden or guessed

Tool grouping collapses repeated calls into a count. It must never collapse a failure, because a count that
includes an error is a summary that lies. Errors flush out of the run and render on their own line.

The same principle covers the empty states: a pane with nothing to show says so in one dim line rather than
rendering a blank hole, because an empty panel is indistinguishable from a broken one.

## 8. The line ratchet is a design constraint, not a nuisance

220 lines per file, and eight modules are within one or two lines of it. When a change needs room, extract
something with a real boundary rather than compressing code into unreadable lines. The extractions this
track has done are all better code than what they replaced:

| Extracted | From |
|---|---|
| `mso-agent-panel-geometry.mjs` | the paint loop |
| `mso-agent-settings-entries.mjs` | the settings loader |
| `mso-agent-tabs-rail.mjs` | the chrome layout |
| `mso-agent-input-hook.mjs` | key and mouse interception |
| `mso-agent-turn-print.mjs` | the printer router |
| `mso-agent-panel-suspend.mjs` | terminal ownership |

## 9. Verify on a real pty, not only in unit tests

Two defects in this track were invisible to every fake-TTY test and only appeared when the actual binary ran
in a real terminal behind a real backend:

- `const screenLoop` declared inside `try` and read in `finally`, so **every exit** threw a
  `ReferenceError` and a clean Ctrl+C became exit code 1.
- A SIGTERM listener that **replaced** node's default termination, so the handler released the screen and
  left the process alive forever.

`scripts/mso-agent-pty.e2e.test.ts` exists for exactly this and should be run after any entrypoint change.

## 10. Local gates decide, CI confirms

`bash scripts/gates-12.sh full` mirrors the Actions verify job: 17 rows, 16 pass and one skip that
`verify-build.sh` enforces inside the same run. It caught an absolute home path the instance guard rejects,
a ratchet regression, and a stale changelog, each of which would otherwise have cost a CI round trip.

Two of its gates are load-sensitive: `tests + coverage` and `perf gate` fail above roughly load 7 and pass
below 4. A red result at high load is not a regression, and the way to tell is to re-run on a quiet host,
not to assume either way.

## 11. Squashing a batch is where work disappears

The batch that shipped eleven branches used `git reset --soft` to collapse them into one commit, and that
silently dropped **three** of them. A soft reset does not include changes from merge commits that are not
reachable by the reset target in the way a squash does. Their modules were missing from `main` while their
tests were present, so nothing looked broken.

Check a batch by file, not by test count:

```bash
for f in <the files the batch should have added>; do
  git cat-file -e origin/main:$f 2>/dev/null || echo "MISSING $f"
done
```

Use `git merge --squash` per branch, or cherry-pick an explicit range, rather than a soft reset over merges.

## 12. A refusal is worth as much as a feature

Five items in the last batch were refused rather than built, each with the file and line that decided it.
That is the correct outcome when the capability does not exist: a placeholder thumbnail, a status glyph
derived from a timestamp, or a volume slider for a bell with no volume are all worse than an honest absence,
because they assert something untrue about the system.

Record the refusal where the next person will look for the setting, not in a chat log.

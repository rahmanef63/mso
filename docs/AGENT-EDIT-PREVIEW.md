# Pending-edit preview: design note

Item 6 in `docs/AGENT-CODING-PLAN.md`: "the TUI cannot show a diff before writing. `/diff`
renders the server's historical artifact diff. There is no preview of a pending edit."

## What is actually missing

Two different things, and only the first one is a coding gap:

1. **The agent cannot preview its own edit.** `fs_edit` writes immediately. An agent that
   wants to check "does this old_string match exactly once, and what exactly changes" has to
   write and then read back, which is a write it cannot undo.
2. **The owner cannot see what changed.** The TUI prints `[write] fs_edit` and then
   `✓ fs_edit`. The change itself is invisible. That is the reason `/diff` exists as a
   separate command, and why it only ever shows historical artifact diffs.

Claude Code and opencode both answer these with the same shape: the edit tool returns the
diff it applied, and the UI renders that diff inline.

## Design

### A pure diff function, not a diff library

`lib/host/fs-edit-diff.ts` exports `editDiff(before, after, { context, maxLines })`.

No diff algorithm. `fs_edit` derives `after` from `before` by one substitution, so the
change region is exactly the common prefix and the common suffix around it. That is cheap,
exact, and cannot misattribute a change the way a heuristic line matcher can. The output is
unified-diff shaped so it renders with the colours `/diff` already uses:

```
@@ -12,6 +12,7 @@
 context
-removed
+added
 context
```

`maxLines` defaults to 40. When the changed region is longer, the hunk is cut and a
`… N more lines` line is appended, with `truncated: true` so the caller knows the diff is
not the whole story. A silently short diff would be worse than no diff.

### `fs_edit` returns the diff it applied, and can dry-run

- Always: `diff`, `diffTruncated` on the result, so the caller sees what happened without a
  follow-up read.
- New `dry_run: true`: compute and validate everything (empty search, uniqueness, size caps,
  CAS hash), return the diff and the projected `sha256`, and **write nothing**.
  `written: false` is in the result so a caller cannot mistake a preview for a commit.

The projected hash in a dry run is deliberately the future hash, not the current one. If a
caller wrongly passes it as `expected_sha256`, the real edit fails as stale, which is a safe
failure. The reverse (returning the current hash) would silently allow a stale write.

### The TUI renders the returned diff

`scripts/mso-agent-edit-diff.mjs` holds the rendering, so `scripts/mso-agent-turn.mjs` grows
by a handful of lines rather than becoming the next file over the 220 ratchet. It renders
under the `✓ fs_edit` row, dim context, green additions, red removals, using the same width
discipline as the rest of the transcript so a long line does not wrap into a wall.

## Bounds

- Diff text is capped per edit (`maxLines`), and the tool result already has a byte cap.
- `dry_run` performs no write, so it cannot be used to probe write access differently than a
  real edit: it runs the same guards before returning.

## Explicitly not in scope

- An interactive approve/reject prompt for each edit. Approval already exists at the tool
  level (`requestExactToolApproval` with a digest); adding a second gate inside the edit
  would mean two places decide the same thing.
- Replacing `/diff`. That command answers "what did this session change to artifacts over
  time", which is a different question from "what did this one call change".

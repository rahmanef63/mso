// DOES THE USER'S MSO SURVIVE THE UPDATE? Answered before anything is touched.
//
// A user who edits their checkout and still wants the newest code should get both
// when git can replay their work, and should be told exactly which files collide
// when it cannot. That question is answered by `git merge-tree --write-tree`, which
// runs the REAL merge machinery in memory: it never writes the index, the worktree,
// or HEAD, and its only side effect is throwaway tree/blob objects in .git/objects
// that `git gc` collects. Never `git merge`, checkout, stash or reset here.
//
// Deliberately free of `server-only` and `@/` imports (same reason as
// update-decision.ts): the nightly timer decides on the same facts outside Next.
import { redactText } from "../security/redact-text";

export type UpdateConflictReport = {
  /** Files git cannot merge automatically. Empty means the update is safe. */
  conflicted: string[];
  /** Files the user changed that will be replayed on top of the new code. */
  carried: string[];
  /** Files the update rewrites that the user also touched (potential clobber). */
  overlap: string[];
  /** True when `git merge-tree` reports no conflict for the incoming ref. */
  safe: boolean;
  /** Bounded, redacted git output for diagnosis. Never a credential. */
  detail: string;
};

export type ConflictGitRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

const DETAIL_MAX = 800;

/** Newline-separated path list → trimmed, de-duplicated, non-empty paths. */
function paths(stdout: string): string[] {
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const value = line.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/**
 * `git merge-tree --write-tree --name-only --no-messages HEAD <ref>` output.
 *
 * Exit 0 is a clean merge and the whole stdout is the resulting tree oid. Exit 1 is
 * conflict: line 1 is a tree oid, every following line is a conflicted path.
 * Anything else is not a merge answer at all (bad ref, unrelated histories).
 */
function probe(stdout: string, code: number): { clean: boolean; conflicted: string[] } {
  const [first = "", ...rest] = stdout.split("\n").map((line) => line.trim());
  if (code === 0) return { clean: /^[0-9a-f]{40,64}$/.test(first), conflicted: [] };
  return { clean: false, conflicted: rest.filter(Boolean) };
}

export async function preflightUpdateConflicts(input: {
  /** Ref the update would move to, already resolved server-side. */
  targetRef: string;
  /** Runner used by the rest of the update path; do not spawn git directly. */
  runner: ConflictGitRunner;
}): Promise<UpdateConflictReport> {
  const { targetRef, runner } = input;
  const empty: UpdateConflictReport = { conflicted: [], carried: [], overlap: [], safe: false, detail: "" };
  const note = (parts: Array<{ stdout: string; stderr: string }>) =>
    redactText(parts.map((p) => `${p.stdout}${p.stderr}`).join("\n").trim(), DETAIL_MAX);

  // Fail closed: without a merge base there is no meaningful "carried" list, and
  // claiming safety would be a guess.
  const base = await runner(["merge-base", "--", "HEAD", targetRef]);
  const mergeBase = base.code === 0 ? base.stdout.trim() : "";
  if (!mergeBase) {
    return { ...empty, detail: note([base]) || `could not find a merge base with ${targetRef}` };
  }

  // Three sets: what the user committed since the merge base, what they changed but
  // never committed (worktree + index), and what they added untracked.
  const [committed, working, untracked, incoming] = await Promise.all([
    runner(["diff", "--name-only", mergeBase, "HEAD"]),
    runner(["diff", "--name-only", "HEAD"]),
    runner(["ls-files", "--others", "--exclude-standard"]),
    runner(["diff", "--name-only", mergeBase, targetRef]),
  ]);
  if (incoming.code !== 0) {
    return { ...empty, detail: note([incoming]) || `could not list the files ${targetRef} changes` };
  }
  const carried = [...new Set([...paths(committed.stdout), ...paths(working.stdout), ...paths(untracked.stdout)])];
  const incomingPaths = paths(incoming.stdout);
  const overlap = carried.filter((file) => incomingPaths.includes(file));

  const merged = await runner(["merge-tree", "--write-tree", "--name-only", "--no-messages", "HEAD", targetRef]);
  const { clean, conflicted } = probe(merged.stdout, merged.code);

  return {
    conflicted,
    carried,
    overlap,
    // merge-tree reads COMMITS, so it cannot prove anything about uncommitted work;
    // an overlapping path is therefore treated as unsafe rather than assumed fine.
    safe: clean && overlap.length === 0,
    detail: note([merged]) || (clean ? "no merge conflicts" : "merge-tree reported conflicts"),
  };
}

/**
 * A paste-ready instruction for a coding agent that has to finish this update by
 * hand. Plain text, no markdown fences: it is pasted into a chat, not rendered.
 */
export function updateConflictPrompt(report: UpdateConflictReport, status: { target: string; current: string }): string {
  const list = (label: string, files: string[], empty: string) =>
    `${label}\n${files.length ? files.map((file) => `- ${file}`).join("\n") : `- ${empty}`}`;

  return [
    `The MSO checkout at commit ${status.current} needs to update to ${status.target}, but the local tree cannot be merged automatically.`,
    "",
    "Help me finish this update without losing any of my changes or configuration.",
    "",
    list("Conflicted files (git cannot merge these automatically):", report.conflicted, "none — only carry-over and overlap apply"),
    "",
    list("My changes that must be preserved and carried onto the new code:", report.carried, "none"),
    "",
    list("Files the update rewrites that I also touched (possible clobber):", report.overlap, "none"),
    "",
    `Update safe to apply as-is: ${report.safe ? "yes" : "no"}`,
    "",
    "What to do:",
    "1. Inspect the conflicted and overlapping files above and resolve each conflict by hand, keeping my intent in both sides.",
    `2. Move the checkout to ${status.target} (fast-forward) and replay my carried changes on top.`,
    "3. Preserve my configuration and private state exactly: anything under ~/.mso, my .env files, and my own local commits.",
    "4. Verify the result builds and runs before declaring success, and report back exactly which files you changed and why.",
    "",
    "Do not run `git push --force`, `git reset --hard`, `git clean -fdx`, or delete any of my files.",
    "Do not drop or overwrite my changes to make the merge pass.",
    "",
    "Git output:",
    report.detail || "(none)",
  ].join("\n");
}

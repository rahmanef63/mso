// Unified-diff shape for a surgical edit, without a diff library.
//
// `fs_edit` replaces one exact substring, so the changed block is the run of lines between
// the common line prefix and the common line suffix. Working in lines rather than characters
// is what keeps an insertion at a line boundary from being reported as a rewrite of the line
// before it, and it is the same granularity `git diff` reports.
//
// The output is deliberately the shape `mso-agent-diff.mjs` already colours, so one renderer
// serves both the historical artifact diff and a live edit.

const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_LINES = 40;

export interface EditDiffOptions {
  /** Unchanged lines shown on each side of the change. */
  context?: number;
  /** Hard cap on rendered lines, header included. A silently short diff is worse than none. */
  maxLines?: number;
}

export interface EditDiffResult {
  diff: string;
  truncated: boolean;
  removed: number;
  added: number;
}

/** A trailing newline terminates the last line, it does not add an empty one. */
const splitLines = (text: string): string[] => {
  if (!text) return [];
  const all = text.split("\n");
  if (all[all.length - 1] === "") all.pop();
  return all;
};

export function editDiff(before: string, after: string, options: EditDiffOptions = {}): EditDiffResult {
  if (before === after) return { diff: "", truncated: false, removed: 0, added: 0 };

  const context = Math.max(0, Math.trunc(options.context ?? DEFAULT_CONTEXT));
  const maxLines = Math.max(3, Math.trunc(options.maxLines ?? DEFAULT_MAX_LINES));

  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);

  let start = 0;
  while (start < beforeLines.length && start < afterLines.length && beforeLines[start] === afterLines[start]) start += 1;

  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;
  while (endBefore > start && endAfter > start && beforeLines[endBefore - 1] === afterLines[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }

  const removed = beforeLines.slice(start, endBefore);
  const added = afterLines.slice(start, endAfter);
  const lead = beforeLines.slice(Math.max(0, start - context), start);
  const trail = beforeLines.slice(endBefore, endBefore + context);
  const hunkStart = Math.max(0, start - context) + 1;
  const header = `@@ -${hunkStart},${lead.length + removed.length + trail.length} +${hunkStart},${lead.length + added.length + trail.length} @@`;

  const body = [
    ...lead.map((line) => ` ${line}`),
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
    ...trail.map((line) => ` ${line}`),
  ];

  const budget = maxLines - 1;
  if (body.length <= budget) {
    return { diff: [header, ...body].join("\n"), truncated: false, removed: removed.length, added: added.length };
  }

  const kept = body.slice(0, Math.max(0, budget - 1));
  const withheld = body.length - kept.length;
  return {
    diff: [header, ...kept, `… ${withheld} more lines`].join("\n"),
    truncated: true,
    removed: removed.length,
    added: added.length,
  };
}

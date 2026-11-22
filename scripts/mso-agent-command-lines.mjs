// Command output buffer for the panel.
//
// Why this exists at all: the transcript is rebuilt from session history on every sync, so a line written
// straight into the viewport survives only until the next sync rebuilds it. Command output is not part of
// history, so it needs somewhere durable to live and a place in the composition order.
//
// Bounded because a runaway command can print without limit and only the tail is ever visible.
const LIMIT = 2000;

export function createCommandLines(limit = LIMIT) {
  const lines = [];
  return {
    lines,
    push(line) {
      lines.push(String(line ?? ""));
      if (lines.length > limit) lines.splice(0, lines.length - limit);
    },
    clear() { lines.length = 0; },
  };
}

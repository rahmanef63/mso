import process from "node:process";
import { cellWidth } from "./tui/cells.mjs";

// Measures physical terminal rows occupied by painted lines, taking terminal column wrapping into account.
export function frameHeight(painted, columns = process.stdout?.columns || 80) {
  const lines = Array.isArray(painted) ? painted : typeof painted === "string" ? [painted] : [];
  if (lines.length === 0) return 0;
  const cols = Math.max(1, Number(columns) || 80);
  let total = 0;
  for (const line of lines) {
    const w = cellWidth(line);
    // An empty line still occupies one physical row in the terminal.
    total += w === 0 ? 1 : Math.max(1, Math.ceil(w / cols));
  }
  return total;
}

// Moves cursor to the start of the block (row 0, col 0) from an offset row.
// Guarded against non-TTY streams so piped or redirect environments do not receive escape noise.
export function cursorHome(output, rows = 0) {
  if (output?.isTTY !== true || !output || typeof output.write !== "function") return;
  const count = Math.max(0, Number(rows) || 0);
  if (count > 0) output.write(`\x1b[${count}A\r`);
  else output.write("\r");
}

// Wraps a block repaint in cursor hide/show escapes to eliminate visual cursor flicker.
// Restores cursor visibility even if the callback throws, and no-ops on non-TTY streams.
export function withCursorHidden(output, fn) {
  if (output?.isTTY !== true || !output || typeof output.write !== "function") {
    return fn();
  }
  output.write("\x1b[?25l");
  try {
    return fn();
  } finally {
    output.write("\x1b[?25h");
  }
}

// Erases a previously painted frame and restores the cursor to the initial top-left origin.
// Uses cursor down and line clear sequences rather than newlines to keep terminal scrollback untouched.
export function eraseFrame(output, painted) {
  if (output?.isTTY !== true || !output || typeof output.write !== "function") return;
  const count = Array.isArray(painted) ? painted.length : Math.max(0, Number(painted) || 0);
  if (count <= 0) return;
  output.write("\r\x1b[2K");
  for (let i = 1; i < count; i++) {
    output.write("\x1b[1B\r\x1b[2K");
  }
  if (count > 1) {
    output.write(`\x1b[${count - 1}A\r`);
  }
}

// Writes a retained frame by diffing row by row against the previous frame.
// Emits only the minimal escape sequences to update changed rows and clear removed rows.
// Never emits a newline inside the frame block so scrollback is never created.
export function writeFrame(output, previous, next) {
  const nxt = Array.isArray(next) ? [...next] : [];
  if (!output || typeof output.write !== "function") return nxt;

  // Non-TTY mode (pipes, file redirects, CI) falls back to sequential lines without escape codes.
  if (output.isTTY !== true) {
    for (const line of nxt) {
      output.write(`${line}\n`);
    }
    return nxt;
  }

  const prev = Array.isArray(previous) ? previous : [];

  // Idempotent redraw: identical frames produce zero output to prevent unnecessary terminal updates.
  if (prev.length === nxt.length && prev.every((line, i) => line === nxt[i])) {
    return nxt;
  }

  // If next frame is empty, clear any existing rows and return early.
  if (nxt.length === 0) {
    if (prev.length > 0) eraseFrame(output, prev);
    return [];
  }

  const maxRows = Math.max(prev.length, nxt.length);
  let currentRow = 0;
  let paintedAny = false;

  for (let i = 0; i < maxRows; i++) {
    const prevLine = prev[i];
    const nextLine = nxt[i];

    if (i < nxt.length) {
      // Skip row if content is unchanged to minimize terminal escape overhead.
      if (prevLine === nextLine) continue;

      if (i > currentRow) {
        output.write(`\x1b[${i - currentRow}B`);
        currentRow = i;
      }
      output.write(`\r\x1b[2K${nextLine}`);
      paintedAny = true;
    } else {
      // Row existed previously but is truncated in the new frame; clear the residual line.
      if (i > currentRow) {
        output.write(`\x1b[${i - currentRow}B`);
        currentRow = i;
      }
      output.write("\r\x1b[2K");
      paintedAny = true;
    }
  }

  // Return cursor to the top origin (row 0, col 0) so callers retain a predictable reference frame.
  if (currentRow > 0) {
    output.write(`\x1b[${currentRow}A\r`);
  } else if (paintedAny) {
    output.write("\r");
  }

  return nxt;
}

// Paints a block at a fixed absolute row instead of relative to the cursor.
//
// The panel above owns rows 1..N and leaves its cursor somewhere inside them. A composer frame that
// grew or shrank then wrote from that cursor, which either ran past the last row (scrolling the screen)
// or, when the panel shrank to make room, pushed its own top rows out of the viewport. Anchoring to a
// row makes overflow arithmetically impossible: the frame cannot start above its top row nor end below
// the last one.
export function writeFrameAt(output, previous, next, topRow, columns = output?.columns || 80) {
  const nxt = Array.isArray(next) ? [...next] : [];
  if (!output || typeof output.write !== "function" || output.isTTY !== true) {
    for (const line of nxt) output.write(`${line}\n`);
    return nxt;
  }
  const rows = Math.max(1, Number(output.rows) || 24);
  const cols = Math.max(1, Number(columns) || 80);
  const prev = Array.isArray(previous) ? previous : [];
  // Clamp so the block always lands inside the terminal, whatever the caller asked for.
  const top = Math.max(1, Math.min(Number(topRow) || 1, Math.max(1, rows - nxt.length + 1)));
  // Clear the previous block FIRST, then paint. Clearing afterwards would erase rows the new frame had
  // just written, which is how a shrinking menu wiped the prompt it was supposed to uncover.
  const previousTop = Math.max(1, Math.min(Number(topRow) || 1, Math.max(1, rows - prev.length + 1)));
  for (let i = 0; i < prev.length; i++) {
    const row = previousTop + i;
    if (row > rows) break;
    output.write(`\x1b[${row};1H\x1b[2K`);
  }
  for (let i = 0; i < nxt.length; i++) {
    const row = top + i;
    if (row > rows) break;
    // One column short of full width: a line that fills the last cell wraps, and wrapping scrolls.
    output.write(`\x1b[${row};1H\x1b[2K${fitToCells(nxt[i], cols - 1)}`);
  }
  return nxt;
}

// Clips a styled line to `max` DISPLAY CELLS, keeping escape sequences.
//
// This used to count code points, so a CJK or emoji line reported half its real width and was emitted at
// up to twice the budget. A line wider than the terminal wraps, and wrapping on the last row scrolls the
// screen — the one thing the retained frame must never do. The width rule now comes from tui/cells.mjs,
// the same module the transcript and pane use, so every renderer agrees on what a cell is.
//
// Tabs are expanded first: a terminal advances a tab to the next multiple of 8, but every measurement here
// counted it as one cell, so tab-indented output (code blocks, pasted text) overflowed and scrolled.
function expandTabs(value) {
  const text = String(value ?? "");
  if (!text.includes("\t")) return text;
  let out = "", col = 0;
  for (let i = 0; i < text.length;) {
    const ansi = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(text.slice(i));
    if (ansi) { out += ansi[0]; i += ansi[0].length; continue; }
    const ch = text[i];
    if (ch === "\t") {
      // Tab stop at the next multiple of 8, which is what the terminal does.
      const spaces = 8 - (col % 8);
      out += " ".repeat(spaces);
      col += spaces;
    } else {
      const cp = text.codePointAt(i) ?? 0;
      const char = String.fromCodePoint(cp);
      out += char;
      col += cellWidth(char);
      i += char.length;
      continue;
    }
    i += 1;
  }
  return out;
}

function fitToCells(value, max) {
  const plainText = expandTabs(value);
  if (stripAnsiWidth(plainText) <= max) return plainText;
  let out = "", shown = 0;
  // for..of walks CODE POINTS, so a surrogate pair is never split into a lone surrogate.
  for (const ch of plainText) {
    const ansi = /^\x1b\[[0-9;?]*[ -/]*[@-~]/.exec(plainText.slice(shown));
    if (ansi) { out += ansi[0]; continue; }
    const w = cellWidth(ch);
    if (shown + w > max) continue;
    out += ch;
    shown += w;
  }
  return out;
}

function stripAnsiWidth(value) {
  return cellWidth(value);
}

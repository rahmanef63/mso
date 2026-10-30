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

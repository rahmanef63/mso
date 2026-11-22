// Pure helpers for transcript search and viewport offset calculation.
import { stripAnsi } from "./tui/cells.mjs";
import { getAllLines } from "./mso-agent-viewport.mjs";

/**
 * Finds all 0-based line indices where plain text includes query (case-insensitive).
 * Strips ANSI escapes from each line before matching so styling does not prevent hits.
 *
 * @param {string[]} lines - Styled or plain transcript lines.
 * @param {string} query - Plain-text search query.
 * @returns {number[]} Array of matching line indices.
 */
export function findMatches(lines, query) {
  if (!Array.isArray(lines) || typeof query !== "string") return [];
  const target = query.trim().toLowerCase();
  // An empty or whitespace-only query matches nothing to prevent accidental whole-buffer hits.
  if (!target) return [];

  const results = [];
  for (let i = 0; i < lines.length; i += 1) {
    const plain = stripAnsi(lines[i]).toLowerCase();
    if (plain.includes(target)) {
      results.push(i);
    }
  }
  return results;
}

/**
 * Computes the viewport offset that places lineIndex inside the visible window.
 *
 * In mso-agent-viewport.mjs, offset 0 is follow mode (pinned to the bottom), and
 * visible lines start at `targetStart = total - r - offset`.
 * To center lineIndex in a window of height r, we target
 * `targetStart = lineIndex - Math.floor(r / 2)` clamped to [0, total - r].
 * Solving for offset: `offset = total - r - targetStart`.
 *
 * @param {object} viewport - Viewport instance containing buffer lines.
 * @param {number} lineIndex - 0-based target line index to make visible.
 * @param {number} [rows] - Optional visible row count override.
 * @returns {number} Clamped offset (>= 0) that makes lineIndex visible.
 */
export function offsetForLine(viewport, lineIndex, rows) {
  if (!viewport) return 0;
  const allLines = getAllLines(viewport);
  const total = allLines.length;
  const r = Math.max(0, Number(rows ?? viewport.rows) || 0);

  // If buffer is empty, height is zero, or all lines fit on screen, offset remains 0.
  if (total === 0 || r === 0 || total <= r) return 0;

  const idx = Math.max(0, Math.min(total - 1, Number(lineIndex) || 0));
  const half = Math.floor(r / 2);
  const targetStart = Math.max(0, Math.min(total - r, idx - half));
  return total - r - targetStart;
}

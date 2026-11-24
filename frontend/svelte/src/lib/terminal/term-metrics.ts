// Grid sizing for the terminal: the PTY must be told the real cols/rows after
// every container resize, so measure the rendered monospace cell instead of
// guessing from a fixed character width.
export type Grid = { cols: number; rows: number };
export type CellMetrics = { charWidth: number; lineHeight: number };

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const MIN_COLS = 20;
export const MAX_COLS = 500;
export const MIN_ROWS = 2;
export const MAX_ROWS = 500;
const PROBE_CHARS = 64;
const FALLBACK_CHAR_WIDTH = 8;
const FALLBACK_LINE_RATIO = 1.45;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Measured in the live document, using the host element's inherited font. */
export function measureCell(host: HTMLElement): CellMetrics {
  const style = getComputedStyle(host);
  const probe = document.createElement("span");
  probe.textContent = "0".repeat(PROBE_CHARS);
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;font:inherit;letter-spacing:inherit;";
  host.appendChild(probe);
  const { width } = probe.getBoundingClientRect();
  host.removeChild(probe);
  const fontSize = Number.parseFloat(style.fontSize) || 13;
  const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * FALLBACK_LINE_RATIO;
  return {
    charWidth: width > 0 ? width / PROBE_CHARS : FALLBACK_CHAR_WIDTH,
    lineHeight: lineHeight > 0 ? lineHeight : fontSize * FALLBACK_LINE_RATIO,
  };
}

export function measureGrid(width: number, height: number, cell: CellMetrics): Grid {
  const cols = Math.floor(width / Math.max(1, cell.charWidth));
  const rows = Math.floor(height / Math.max(1, cell.lineHeight));
  return {
    cols: clamp(Number.isFinite(cols) ? cols : DEFAULT_COLS, MIN_COLS, MAX_COLS),
    rows: clamp(Number.isFinite(rows) ? rows : DEFAULT_ROWS, MIN_ROWS, MAX_ROWS),
  };
}

export function gridEquals(a: Grid, b: Grid): boolean {
  return a.cols === b.cols && a.rows === b.rows;
}

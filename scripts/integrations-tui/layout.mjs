export {
  stripAnsi,
  clean,
  cellWidth,
  fitCells,
  paneWidths,
  border,
  paneRow,
  compose,
  windowFor,
} from "../tui/cells.mjs";

export function maxPaneCount(cols) {
  return cols >= 132 ? 4 : cols >= 92 ? 3 : cols >= 68 ? 2 : 1;
}

export function visibleColumns(columns, cols) {
  const count = Math.max(1, Math.min(maxPaneCount(cols), columns.length));
  return columns.slice(-count);
}

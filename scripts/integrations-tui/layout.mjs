export function stripAnsi(value) {
  return String(value ?? "").replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
export function clean(value) {
  return stripAnsi(value).replace(/[\r\n\t]+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
function isWide(cp) {
  return cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd));
}
export function cellWidth(value) {
  let total = 0;
  for (const ch of stripAnsi(value)) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x300 && cp <= 0x36f)) continue;
    total += isWide(cp) ? 2 : 1;
  }
  return total;
}
export function fitCells(value, width, { pad = true } = {}) {
  const text = clean(value);
  if (width <= 0) return "";
  let out = "", used = 0;
  for (const ch of text) {
    const w = cellWidth(ch);
    if (used + w > width) break;
    out += ch; used += w;
  }
  if (used < cellWidth(text) && width > 0) {
    while (out && cellWidth(out) > Math.max(0, width - 1)) out = out.slice(0, -1);
    out += "…"; used = cellWidth(out);
  }
  return pad ? out + " ".repeat(Math.max(0, width - used)) : out;
}
export function maxPaneCount(cols) {
  return cols >= 132 ? 4 : cols >= 92 ? 3 : cols >= 68 ? 2 : 1;
}
export function visibleColumns(columns, cols) {
  const count = Math.max(1, Math.min(maxPaneCount(cols), columns.length));
  return columns.slice(-count);
}
export function paneWidths(totalWidth, count) {
  const inner = Math.max(count * 10, totalWidth - (count + 1));
  const base = Math.floor(inner / count), extra = inner % count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
export function border(widths, kind = "top") {
  const chars = kind === "top" ? ["┌", "┬", "┐"] : kind === "mid" ? ["├", "┼", "┤"] : ["└", "┴", "┘"];
  return chars[0] + widths.map((w) => "─".repeat(w)).join(chars[1]) + chars[2];
}
export function paneRow(cells, widths) {
  return "│" + widths.map((w, i) => fitCells(cells[i] ?? "", w)).join("│") + "│";
}
export function compose(left, right, width) {
  const l = clean(left), r = clean(right), gap = Math.max(1, width - cellWidth(l) - cellWidth(r));
  return fitCells(`${l}${" ".repeat(gap)}${r}`, width);
}
export function windowFor(items, selected, height) {
  if (items.length <= height) return { start: 0, end: items.length };
  let start = Math.max(0, selected - Math.floor(height / 2));
  start = Math.min(start, Math.max(0, items.length - height));
  return { start, end: Math.min(items.length, start + height) };
}

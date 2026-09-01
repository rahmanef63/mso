import { fit, pad } from "./mso-agent-editing.mjs";

export const CLEAR_LINE = "\x1b[2K";
export const CURSOR_UP = (n) => n > 0 ? `\x1b[${n}A` : "";
export const CURSOR_DOWN = (n) => n > 0 ? `\x1b[${n}B` : "";
export const CURSOR_RIGHT = (n) => n > 0 ? `\x1b[${n}C` : "";
export const CLEAR_SCREEN = "\x1b[2J\x1b[H";
const plain = (value) => String(value ?? "").replace(/\x1b\[[0-9;]*m/g, "");
export const chars = (value) => Array.from(String(value ?? ""));
export const width = (value) => chars(plain(value)).length;
export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function inputViewport(value, cursor, maxWidth) {
  const row = chars(value), max = Math.max(1, maxWidth);
  if (row.length <= max) return { display: row.join(""), cursor: clamp(cursor, 0, row.length) };
  const interior = Math.max(1, max - 2);
  let start = clamp(cursor - Math.floor(interior * 0.7), 0, Math.max(0, row.length - interior));
  let end = Math.min(row.length, start + interior);
  if (cursor > end) { end = cursor; start = Math.max(0, end - interior); }
  const prefix = start > 0 ? "…" : "", suffix = end < row.length ? "…" : "";
  return { display: `${prefix}${row.slice(start, end).join("")}${suffix}`, cursor: width(prefix) + clamp(cursor - start, 0, end - start) };
}

export function completionWindow(items, selected, size = 8) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return { start: 0, items: [] };
  const count = Math.min(Math.max(1, size), rows.length), idx = clamp(selected, 0, rows.length - 1);
  const start = Math.max(0, Math.min(idx - Math.floor(count / 2), rows.length - count));
  return { start, items: rows.slice(start, start + count) };
}

export function menuLines(items, selected, columns, C, panelLabel = "commands & skills") {
  const { start, items: visible } = completionWindow(items, selected, 8);
  if (!visible.length) return [];
  const panelWidth = Math.max(38, Math.min(100, Number(columns || 100) - 2));
  const label = ` ${fit(panelLabel, Math.max(12, panelWidth - 8))} `;
  const top = `╭─${label}${"─".repeat(Math.max(0, panelWidth - width(label) - 3))}╮`;
  const nameWidth = Math.min(42, Math.max(12, ...visible.map((item) => width(item.label || item.text) + 1)));
  const metaWidth = Math.max(0, panelWidth - nameWidth - 9);
  const body = visible.map((item, offset) => {
    const active = start + offset === selected;
    const marker = active ? `${C.blue}${C.bold}›${C.reset}` : " ";
    const stateColor = item.state === "queued" ? C.warn : ["invoking", "invoked"].includes(item.state) ? C.c : C.blue;
    const stateMark = item.kind === "skill" ? `${stateColor}${item.state === "invoked" ? "✓" : item.state === "ready" ? "◇" : "◆"}${C.reset}` : " ";
    const nameColor = item.kind === "skill" ? stateColor : active ? C.blue : "";
    const displayText = item.label || item.text;
    const name = nameColor ? `${nameColor}${active ? C.bold : ""}${pad(displayText, nameWidth)}${C.reset}` : pad(displayText, nameWidth);
    const metaText = fit(item.meta || "", metaWidth), meta = metaWidth ? `${C.dim}${metaText}${C.reset}` : "";
    return `│ ${marker} ${stateMark} ${name}${meta ? ` ${meta}` : ""}${" ".repeat(Math.max(0, metaWidth - width(metaText)))} │`;
  });
  const hint = " ↑↓ navigate · Enter/Tab select · Esc close ";
  const bottomText = fit(hint, panelWidth - 3);
  const bottom = `╰─${bottomText}${"─".repeat(Math.max(0, panelWidth - width(bottomText) - 3))}╯`;
  return [`${C.blue}${top}${C.reset}`, ...body, `${C.blue}${bottom}${C.reset}`];
}

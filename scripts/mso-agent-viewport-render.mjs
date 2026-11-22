import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import { getAllLines, viewportWindow } from "./mso-agent-viewport.mjs";

// Produces a vertical scrollbar column with thumb and track characters matching offset position.
export function scrollbarColumn(viewport, rows, { width = 1 } = {}) {
  const r = Math.max(0, Number(rows ?? viewport?.rows) || 0);
  const w = Math.max(0, Number(width) || 0);
  const allLines = getAllLines(viewport);
  const total = allLines.length;
  if (r <= 0 || w < 1 || total <= r) return [];

  const clampedOffset = Math.max(0, Math.min(viewport.offset, total - r));
  const targetStart = total - r - clampedOffset;
  const thumbHeight = Math.max(1, Math.min(r, Math.round((r / total) * r)));
  const maxThumbTop = r - thumbHeight;
  const thumbTop = maxThumbTop > 0
    ? Math.max(0, Math.min(maxThumbTop, Math.round((targetStart / (total - r)) * maxThumbTop)))
    : 0;

  const column = [];
  for (let i = 0; i < r; i++) {
    column.push(i >= thumbTop && i < thumbTop + thumbHeight ? "█" : "│");
  }
  return column;
}

// Clips content line to target width, handling wide CJK boundaries and appending ellipsis cleanly.
function fitViewportLine(rawText, targetWidth) {
  if (targetWidth <= 0) return "";
  const plainText = stripAnsi(rawText).replace(/[\r\n\t]+/g, " ");
  const currentWidth = cellWidth(plainText);
  if (currentWidth <= targetWidth) {
    return rawText + " ".repeat(targetWidth - currentWidth);
  }

  let accumulated = "", usedWidth = 0;
  for (const ch of plainText) {
    const chWidth = cellWidth(ch);
    if (usedWidth + chWidth > targetWidth) break;
    accumulated += ch;
    usedWidth += chWidth;
  }

  if (usedWidth < currentWidth && targetWidth > 0) {
    while (accumulated && cellWidth(accumulated) > Math.max(0, targetWidth - 1)) {
      accumulated = Array.from(accumulated).slice(0, -1).join("");
    }
    accumulated += "…";
    usedWidth = cellWidth(accumulated);
  }
  return accumulated + " ".repeat(Math.max(0, targetWidth - usedWidth));
}

// Renders the viewport lines padded or clipped to width with optional scrollbar in the final column.
export function renderViewport(viewport, { colors = {}, width = 80, rows = 24 } = {}) {
  const r = Math.max(0, Number(rows ?? viewport?.rows) || 0);
  const w = Math.max(0, Number(width) || 0);
  if (r === 0 || w === 0) return [];

  const { lines: visible } = viewportWindow(viewport, r);
  const scrollbar = scrollbarColumn(viewport, r, { width: 1 });
  const hasScrollbar = Array.isArray(scrollbar) && scrollbar.length === r;
  const contentWidth = hasScrollbar ? Math.max(0, w - 1) : w;
  const cDim = colors?.dim || "", cReset = colors?.reset || "";

  const out = [];
  for (let i = 0; i < r; i++) {
    const raw = i < visible.length ? visible[i] : "";
    const content = fitViewportLine(raw, contentWidth);
    if (hasScrollbar) {
      const barChar = scrollbar[i];
      const styledBar = cDim ? `${cDim}${barChar}${cReset}` : barChar;
      out.push(`${content}${styledBar}`);
    } else {
      out.push(content);
    }
  }
  return out;
}

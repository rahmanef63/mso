import { cellWidth, clean, fitCells } from "./tui/cells.mjs";
import { composerFooter } from "./mso-agent-layout.mjs";

function candidateSplits(kept, total, activeIdx) {
  const splits = [];
  for (let l = 0; l <= kept; l++) {
    const r = kept - l;
    if (activeIdx < 0 || activeIdx < l || r > total - 1 - activeIdx) splits.push(l);
  }
  const all = splits.length ? splits : Array.from({ length: kept + 1 }, (_, i) => i);
  return all.sort((a, b) => Math.abs(a - kept / 2) - Math.abs(b - kept / 2));
}

function makeSegments(itemsList, orientation = "horizontal", maxWidth = 80) {
  if (orientation === "vertical") {
    const contentWidth = Math.max(1, maxWidth - 1);
    return itemsList.map((it, row) => {
      if (!it) return null;
      return {
        type: it.type || "tab",
        id: it.id,
        row,
        start: 0,
        end: Math.min(it.width, contentWidth),
        styled: fitCells(it.styled || it.plainText || "", contentWidth, { pad: false }),
        plainText: it.plainText || it.text || "",
        text: it.text,
        isActive: Boolean(it.isActive),
      };
    }).filter(Boolean);
  }
  let col = 0;
  const segments = [];
  for (const it of itemsList) {
    if (!it) continue;
    segments.push({ type: it.type || "tab", id: it.id, start: col, end: col + it.width, styled: it.styled, text: it.text });
    col += it.width + 2;
  }
  return segments;
}

/** @param {Array<any>} sessions @param {string|number|null} [activeId] @param {any} [options] */
export function tabLayout(sessions, activeId = null, { colors = {}, width = 80, rows = null, orientation = "horizontal" } = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { segments: [], maxWidth: Math.max(1, Number(width) || 80) };
  }
  const maxWidth = Math.max(1, Number(width) || 80);
  const sep = "  ";
  const cBold = colors?.bold || "", cBlue = colors?.blue || "", cDim = colors?.dim || "", cReset = colors?.reset || "";

  const items = sessions.map((s) => {
    const rawName = clean(s?.name || s?.agentSession?.name || "").replace(/^@/, "");
    const name = rawName || "agent";
    const id = String(s?.id || s?.agentSession?.id || "");
    const isActive = activeId != null && (String(activeId) === id || String(activeId).replace(/^@/, "") === name);
    const marker = isActive ? "● " : "";
    const plainText = `${marker}@${name}`;
    const styled = isActive ? `${cBold}${cBlue}${marker}@${name}${cReset}` : `${cDim}@${name}${cReset}`;
    return { id, name, isActive, plainText, styled, width: cellWidth(plainText) };
  });

  const activeIdx = items.findIndex((it) => it.isActive);

  if (orientation === "vertical") {
    const maxRows = rows != null ? Math.max(0, Number(rows)) : items.length;
    if (maxRows === 0) return { segments: [], maxWidth };
    if (items.length <= maxRows) return { segments: makeSegments(items, "vertical", maxWidth), maxWidth };
    const kept = Math.max(0, maxRows - 1);
    if (kept === 0) {
      const fallback = activeIdx >= 0 ? items[activeIdx] : items[0];
      return { segments: makeSegments([fallback], "vertical", maxWidth), maxWidth };
    }
    const dropped = items.length - kept;
    const markerText = `+${dropped}`;
    const marker = { type: "marker", text: markerText, styled: `${cDim}${markerText}${cReset}`, width: cellWidth(markerText) };
    const l = candidateSplits(kept, items.length, activeIdx)[0] ?? 0;
    const left = items.slice(0, l), right = items.slice(items.length - (kept - l));
    return { segments: makeSegments([...left, marker, ...right], "vertical", maxWidth), maxWidth };
  }

  const fullPlain = items.map((it) => it.plainText).join(sep);
  if (cellWidth(fullPlain) <= maxWidth) return { segments: makeSegments(items, "horizontal", maxWidth), maxWidth };

  for (let dropped = 1; dropped < items.length; dropped++) {
    const kept = items.length - dropped;
    const markerText = `+${dropped}`;
    const marker = { type: "marker", text: markerText, styled: `${cDim}${markerText}${cReset}`, width: cellWidth(markerText) };
    for (const leftCount of candidateSplits(kept, items.length, activeIdx)) {
      const leftItems = items.slice(0, leftCount), rightItems = items.slice(items.length - (kept - leftCount));
      const candidatePlain = [...leftItems.map((it) => it.plainText), markerText, ...rightItems.map((it) => it.plainText)].filter(Boolean).join(sep);
      if (cellWidth(candidatePlain) <= maxWidth) {
        return { segments: makeSegments([...leftItems, marker, ...rightItems], "horizontal", maxWidth), maxWidth };
      }
    }
  }

  const fallbackItem = activeIdx >= 0 ? items[activeIdx] : items[0];
  const truncatedStyled = fitCells(fallbackItem.styled, maxWidth, { pad: false });
  return {
    segments: [{ type: "tab", id: fallbackItem.id, start: 0, end: Math.min(fallbackItem.width, maxWidth), styled: truncatedStyled }],
    maxWidth,
  };
}

/** @param {Array<any>} sessions @param {string|number|null} [activeId] @param {any} [options] */
export function tabRow(sessions, activeId = null, options = {}) {
  const { segments } = tabLayout(sessions, activeId, options);
  return segments.map((s) => s.styled).join("  ");
}

// Side rail width: floor 18 preserves readable names; ceiling 26 avoids crowding transcript.
// Returns 0 below 100 columns so narrow terminals keep transcript space just as paneWidth does.
export function tabRailWidth(columns, { minColumns = 100 } = {}) {
  const cols = Number(columns) || 0;
  if (cols < minColumns) return 0;
  return Math.max(18, Math.min(26, Math.floor(cols * 0.18)));
}

/** @param {Array<any>} sessions @param {string|number|null} [activeId] @param {any} [options] */
export function tabRailLines(sessions, activeId = null, options = {}) {
  const { segments, maxWidth } = tabLayout(sessions, activeId, { ...options, orientation: "vertical" });
  const rows = Math.max(0, Number(options?.rows) || segments.length);
  const contentWidth = Math.max(1, maxWidth - 1);
  const colors = options?.colors || {};
  const cBold = colors.bold || "", cBlue = colors.blue || "", cDim = colors.dim || "", cReset = colors.reset || "";
  const borderChar = cDim ? `${cDim}│${cReset}` : "│";
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const seg = segments.find((s) => s.row === r);
    if (!seg) {
      lines.push(" ".repeat(contentWidth) + borderChar);
      continue;
    }
    const plain = fitCells(seg.plainText || "", contentWidth, { pad: false });
    const pad = " ".repeat(Math.max(0, contentWidth - cellWidth(plain)));
    const styled = seg.isActive ? `${cBold}${cBlue}${plain}${cReset}` : (cDim ? `${cDim}${plain}${cReset}` : plain);
    lines.push(styled + pad + borderChar);
  }
  return lines;
}

/** @param {Array<any>} sessions @param {string|number|null} [activeId] @param {any} [point] @param {any} [options] */
export function tabAtPoint(sessions, activeId = null, point = {}, options = {}) {
  const opts = typeof point === "object" && point !== null ? { ...options, ...point } : (options || {});
  const x = typeof point === "number" ? point : Number(opts?.x) || 0;
  const y = typeof opts?.y === "number" ? opts.y : 0;
  const orientation = opts?.orientation || "horizontal";
  const { segments } = tabLayout(sessions, activeId, opts);
  if (orientation === "vertical") {
    const hit = segments.find((s) => s.type === "tab" && s.row === y && x >= s.start && x < s.end);
    return hit ? hit.id : null;
  }
  const tabRowY = typeof opts?.tabRow === "number" ? opts.tabRow : (typeof opts?.row === "number" ? opts.row : 0);
  if (y !== tabRowY) return null;
  const hit = segments.find((s) => s.type === "tab" && x >= s.start && x < s.end);
  return hit ? hit.id : null;
}

/** @param {{ session?: any, sessions?: Array<any>, activeId?: string|number|null, colors?: any, width?: number, rows?: number|null, footer?: any }} [options] */
export function chromeLines({
  session = null,
  sessions = /** @type {Array<any>} */ ([]),
  activeId = null,
  colors = {},
  width = 80,
  rows = null,
  footer = null,
} = {}) {
  const termRows = rows != null ? Number(rows) : null;
  if (termRows !== null && termRows <= 6) return [];
  const tab = tabRow(sessions, activeId, { colors, width });
  if (termRows !== null && termRows <= 8) return tab ? [tab] : [];

  let foot = "";
  if (footer != null) {
    foot = typeof footer === "function" ? String(footer() || "") : String(footer || "");
  } else if (session != null) {
    foot = String(composerFooter(session, colors, width) || "");
  }
  return [tab, foot].filter((line) => typeof line === "string" && line.trim().length > 0).slice(0, 2);
}

/** @param {Array<any>} sessions @param {any} args */
export function tabsToSwitch(sessions, args) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const raw = Array.isArray(args) ? args.join(" ").trim() : String(args ?? "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const idx = Number.parseInt(raw, 10);
    return idx >= 1 && idx <= sessions.length ? sessions[idx - 1] ?? null : null;
  }
  const query = raw.toLowerCase().replace(/^@/, "");
  const getName = (s) => clean(s?.name || s?.agentSession?.name || "").toLowerCase().replace(/^@/, "");
  const getId = (s) => String(s?.id || s?.agentSession?.id || "").toLowerCase();
  for (const match of [
    (s) => getName(s) === query,
    (s) => getId(s) === query,
    (s) => getName(s).startsWith(query),
    (s) => getId(s).startsWith(query),
  ]) {
    const hits = sessions.filter(match);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

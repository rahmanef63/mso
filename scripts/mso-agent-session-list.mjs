import { cellWidth, clean } from "./tui/cells.mjs";
import { formatSessionModified } from "./mso-agent-sessions.mjs";

// Interactive turns (LLM calls, tool runs) typically complete within 60 seconds.
// An update timestamp within 60 seconds indicates active execution.
// Past 60 seconds without updates, the session is considered idle.
export const ACTIVITY_THRESHOLD_MS = 60_000;

/**
 * @param {any} row
 * @param {number} [now]
 * @returns {{ state: string, label: string }}
 */
export function stateOf(row, now = Date.now()) {
  if (!row || typeof row !== "object") {
    return { state: "unknown", label: "no activity data" };
  }

  // Explicit failure or error status takes precedence.
  if (row.error || ["error", "errored", "failed"].includes(String(row.status || ""))) {
    return { state: "errored", label: "errored" };
  }

  // Explicit waiting or prompt-ready state.
  if (["waiting", "waiting for input"].includes(String(row.status || ""))) {
    return { state: "waiting", label: "waiting for input" };
  }

  // Explicit running or busy status flag.
  if (["working", "busy", "running"].includes(String(row.status || ""))) {
    return { state: "working", label: "working" };
  }

  if (row.status === "idle") {
    return { state: "idle", label: "idle" };
  }

  // In the absence of an explicit status flag, derive state from the last recorded update.
  const rawTime = row.updatedAt || row.createdAt;
  const at = Date.parse(String(rawTime || ""));
  if (!Number.isFinite(at)) {
    return { state: "unknown", label: "no activity data" };
  }

  // Clock skew tolerance: future timestamps are treated as current activity.
  const diff = Math.max(0, Number(now) - at);
  if (diff <= ACTIVITY_THRESHOLD_MS) {
    return { state: "working", label: "working" };
  }
  return { state: "idle", label: "idle" };
}

function stateColor(state, colors = {}) {
  if (state === "working") return colors.green || "";
  if (state === "waiting") return colors.yellow || "";
  if (state === "errored") return colors.red || colors.err || "";
  if (state === "idle") return colors.dim || "";
  return colors.dim || "";
}

function formatCell(text, width) {
  const cleaned = clean(text);
  if (width <= 0) return { visible: "", pad: "" };
  let out = "";
  let used = 0;
  for (const ch of cleaned) {
    const w = cellWidth(ch);
    if (used + w > width) break;
    out += ch;
    used += w;
  }
  if (used < cellWidth(cleaned) && width > 0) {
    while (out && cellWidth(out) > Math.max(0, width - 1)) {
      out = Array.from(out).slice(0, -1).join("");
    }
    out += "…";
    used = cellWidth(out);
  }
  const pad = " ".repeat(Math.max(0, width - used));
  return { visible: out, pad };
}

function isSessionActive(row, activeId) {
  if (activeId == null) return false;
  const id = String(row?.id || row?.agentSession?.id || "");
  const name = clean(row?.name || row?.agentSession?.name || "").replace(/^@/, "");
  return String(activeId) === id || String(activeId).replace(/^@/, "") === name;
}

/**
 * @param {Array<any>} rows
 * @param {{
 *   colors?: Record<string, string>,
 *   width?: number,
 *   activeId?: string | number | null,
 *   now?: number,
 * }} [options]
 * @returns {Array<string>}
 */
export function sessionTable(rows, { colors = {}, width = 80, activeId = null, now = Date.now() } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return ["No active sessions."];
  }

  const maxW = Math.max(20, Number(width) || 80);
  const sep = "  ";
  const sepW = 2;
  const totalGaps = sepW * 3;
  const available = Math.max(4, maxW - totalGaps);

  // Allocate column widths proportionally while guaranteeing exact fit within width.
  const actW = Math.max(6, Math.min(12, Math.floor(available * 0.18)));
  const stateW = Math.max(8, Math.min(18, Math.floor(available * 0.26)));
  const nameW = Math.max(8, Math.min(16, Math.floor(available * 0.26)));
  const titleW = Math.max(4, available - nameW - stateW - actW);

  const cBold = colors?.bold || "";
  const cBlue = colors?.blue || "";
  const cDim = colors?.dim || "";
  const cReset = colors?.reset || "";

  const hName = formatCell("  NAME", nameW);
  const hTitle = formatCell("TITLE", titleW);
  const hState = formatCell("STATE", stateW);
  const hAct = formatCell("ACTIVITY", actW);

  const headerLine = cBold
    ? `${cBold}${hName.visible}${cReset}${hName.pad}${sep}${cBold}${hTitle.visible}${cReset}${hTitle.pad}${sep}${cBold}${hState.visible}${cReset}${hState.pad}${sep}${cBold}${hAct.visible}${cReset}${hAct.pad}`
    : `${hName.visible}${hName.pad}${sep}${hTitle.visible}${hTitle.pad}${sep}${hState.visible}${hState.pad}${sep}${hAct.visible}${hAct.pad}`;

  const lines = [headerLine];

  rows.forEach((row, idx) => {
    const isCurrent = isSessionActive(row, activeId);
    const mark = isCurrent ? "●" : " ";
    const rawName = clean(row?.name || "agent").replace(/^@/, "");
    const nameText = `${mark} ${idx + 1}. @${rawName}`;
    const titleText = clean(row?.title || "MSO Agent session");

    const stateInfo = stateOf(row, now);
    // "recently" is the shared helper's word for a missing timestamp, which reads as a claim that
    // something happened. In an activity column that is exactly the claim we must not make.
    const stamp = row?.updatedAt || row?.createdAt;
    const actText = stamp ? formatSessionModified(stamp, now) : "unknown";

    const cellName = formatCell(nameText, nameW);
    const cellTitle = formatCell(titleText, titleW);
    const cellState = formatCell(stateInfo.label, stateW);
    const cellAct = formatCell(actText, actW);

    const sc = stateColor(stateInfo.state, colors);

    const nameStyled = isCurrent && cBold
      ? `${cBold}${cBlue}${cellName.visible}${cReset}${cellName.pad}`
      : `${cellName.visible}${cellName.pad}`;
    const titleStyled = isCurrent && cBold
      ? `${cBold}${cellTitle.visible}${cReset}${cellTitle.pad}`
      : `${cellTitle.visible}${cellTitle.pad}`;
    const stateStyled = sc && cReset
      ? `${sc}${cellState.visible}${cReset}${cellState.pad}`
      : `${cellState.visible}${cellState.pad}`;
    const actStyled = cDim && cReset
      ? `${cDim}${cellAct.visible}${cReset}${cellAct.pad}`
      : `${cellAct.visible}${cellAct.pad}`;

    lines.push(`${nameStyled}${sep}${titleStyled}${sep}${stateStyled}${sep}${actStyled}`);
  });

  return lines;
}

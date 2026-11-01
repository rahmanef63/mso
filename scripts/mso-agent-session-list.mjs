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
  if (row.error || ["error", "errored", "failed"].includes(String(row.status || ""))) return { state: "errored", label: "errored" };
  // Explicit waiting or prompt-ready state.
  if (["waiting", "waiting for input"].includes(String(row.status || ""))) return { state: "waiting", label: "waiting for input" };
  // Explicit running or busy status flag.
  if (["working", "busy", "running"].includes(String(row.status || ""))) return { state: "working", label: "working" };
  if (row.status === "idle") return { state: "idle", label: "idle" };

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

  const cBold = colors?.bold || "", cBlue = colors?.blue || "", cDim = colors?.dim || "", cReset = colors?.reset || "";
  const hName = formatCell("  NAME", nameW), hTitle = formatCell("TITLE", titleW);
  const hState = formatCell("STATE", stateW), hAct = formatCell("ACTIVITY", actW);

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

    const cellName = formatCell(nameText, nameW), cellTitle = formatCell(titleText, titleW);
    const cellState = formatCell(stateInfo.label, stateW), cellAct = formatCell(actText, actW);
    const sc = stateColor(stateInfo.state, colors);

    const nameStyled = isCurrent && cBold ? `${cBold}${cBlue}${cellName.visible}${cReset}${cellName.pad}` : `${cellName.visible}${cellName.pad}`;
    const titleStyled = isCurrent && cBold ? `${cBold}${cellTitle.visible}${cReset}${cellTitle.pad}` : `${cellTitle.visible}${cellTitle.pad}`;
    const stateStyled = sc && cReset ? `${sc}${cellState.visible}${cReset}${cellState.pad}` : `${cellState.visible}${cellState.pad}`;
    const actStyled = cDim && cReset ? `${cDim}${cellAct.visible}${cReset}${cellAct.pad}` : `${cellAct.visible}${cellAct.pad}`;

    lines.push(`${nameStyled}${sep}${titleStyled}${sep}${stateStyled}${sep}${actStyled}`);
  });

  return lines;
}

/**
 * Pure predicate determining whether a session row needs attention.
 * A session needs attention if its derived state is "working" (updated within the
 * threshold) or carries an explicit error state ("errored").
 * We intentionally exclude "unknown": missing activity data means we do not know,
 * and jumping to a session on a guess is the dishonesty the table avoids.
 *
 * @param {any} row
 * @param {number} [now]
 * @returns {boolean}
 */
export function needsAttention(row, _now = Date.now()) {
  // Deliberately does NOT use stateOf. That function derives working/idle from updatedAt, and updatedAt
  // is written at turn COMPLETION, not during a turn (persistSession runs at the end, see
  // docs/AGENT-ACTIVITY-SIGNAL.md). So the timestamp derivation is inverted: a session whose turn just
  // ended reads as working for 60 seconds, and a session streaming for three minutes reads as idle.
  // Jumping on that would send the user to the wrong session, which is worse than not jumping.
  //
  // Only an explicit status is trusted here, because only an explicit status came from the server
  // saying so. Absent one, the honest answer is "cannot tell", and this returns false.
  if (!row || typeof row !== "object") return false;
  const status = String(row.status || "");
  if (row.error || ["error", "errored", "failed"].includes(status)) return true;
  return ["working", "busy", "running"].includes(status);
}

/**
 * Honest description of why the session was selected, avoiding unearned certainty.
 *
 * @param {any} row
 * @param {number} [now]
 * @returns {string}
 */
export function attentionReason(row) {
  // Reports the reason needsAttention returned true, and nothing else. It must not mention a
  // timestamp, because needsAttention does not consider timestamps: saying "updated 12s ago" would
  // imply the jump was based on freshness, which is the inverted signal this deliberately avoids.
  if (!row || typeof row !== "object") return "unknown";
  if (row.error || ["error", "errored", "failed"].includes(String(row.status || ""))) {
    return `status: ${row.status || "errored"}`;
  }
  return `status: ${String(row.status || "working")}`;
}

/**
 * Stable pure resolution of the next or previous session needing attention.
 * Walks forward or backward from the active session index, wrapping once.
 *
 * @param {Array<any>} rows
 * @param {string | number | null} [activeId]
 * @param {"next" | "prev" | "previous"} [direction]
 * @param {number} [now]
 * @returns {any | null}
 */
export function findAttentionSession(rows, activeId = null, direction = "next", now = Date.now()) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const isPrev = direction === "prev" || direction === "previous";
  const currentIdx = rows.findIndex((r) => isSessionActive(r, activeId));
  const count = rows.length;
  const start = currentIdx >= 0 ? currentIdx : (isPrev ? 0 : -1);
  const limit = currentIdx >= 0 ? count - 1 : count;
  for (let step = 1; step <= limit; step++) {
    const offset = isPrev ? -step : step;
    const idx = ((start + offset) % count + count) % count;
    if (needsAttention(rows[idx], now)) return rows[idx];
  }
  return null;
}


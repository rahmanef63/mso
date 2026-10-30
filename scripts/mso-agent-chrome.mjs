import { cellWidth, clean, fitCells } from "./tui/cells.mjs";
import { composerFooter } from "./mso-agent-layout.mjs";

/**
 * Formats a single physical row containing session tabs.
 * Active session is marked with a bullet and undimmed; inactive tabs are dimmed.
 * When tabs exceed available width, excess items are dropped from the middle and
 * replaced with a visible +N marker so the row never wraps and breaks row arithmetic.
 *
 * @param {Array<any>} sessions
 * @param {string|number|null} [activeId]
 * @param {{ colors?: any, width?: number }} [options]
 * @returns {string}
 */
export function tabRow(sessions, activeId = null, { colors = {}, width = 80 } = {}) {
  if (!Array.isArray(sessions) || sessions.length === 0) return "";
  const maxWidth = Math.max(1, Number(width) || 80);
  const sep = "  ";

  const cBold = colors?.bold || "";
  const cBlue = colors?.blue || "";
  const cDim = colors?.dim || "";
  const cReset = colors?.reset || "";

  const items = sessions.map((s) => {
    const rawName = clean(s?.name || s?.agentSession?.name || "").replace(/^@/, "");
    const name = rawName || "agent";
    const id = String(s?.id || s?.agentSession?.id || "");
    const isActive = activeId != null && (String(activeId) === id || String(activeId).replace(/^@/, "") === name);
    const marker = isActive ? "● " : "";
    const plainText = `${marker}@${name}`;
    const styled = isActive
      ? `${cBold}${cBlue}${marker}@${name}${cReset}`
      : `${cDim}@${name}${cReset}`;
    return { id, name, isActive, plainText, styled, width: cellWidth(plainText) };
  });

  const fullPlain = items.map((it) => it.plainText).join(sep);
  if (cellWidth(fullPlain) <= maxWidth) {
    return items.map((it) => it.styled).join(sep);
  }

  // Dropping from the middle keeps both endpoints visible while indicating hidden tabs.
  const activeIdx = items.findIndex((it) => it.isActive);

  for (let dropped = 1; dropped < items.length; dropped++) {
    const kept = items.length - dropped;
    const markerText = `+${dropped}`;
    const markerStyled = `${cDim}${markerText}${cReset}`;

    // Candidate splits between left and right items.
    // When an active tab exists, prefer splits that preserve the active tab.
    const candidateSplits = [];
    for (let l = 0; l <= kept; l++) {
      const r = kept - l;
      const preservesActive = activeIdx < 0 || activeIdx < l || r > (items.length - 1 - activeIdx);
      if (preservesActive) candidateSplits.push(l);
    }
    // Fall back to all splits if none could preserve active with this kept count.
    if (candidateSplits.length === 0) {
      for (let l = 0; l <= kept; l++) candidateSplits.push(l);
    }
    // Sort by proximity to balanced halves to drop symmetrically from the middle.
    candidateSplits.sort((a, b) => Math.abs(a - kept / 2) - Math.abs(b - kept / 2));

    for (const leftCount of candidateSplits) {
      const rightCount = kept - leftCount;
      const leftItems = items.slice(0, leftCount);
      const rightItems = items.slice(items.length - rightCount);

      const candidatePlain = [
        ...leftItems.map((it) => it.plainText),
        markerText,
        ...rightItems.map((it) => it.plainText),
      ].filter(Boolean).join(sep);

      if (cellWidth(candidatePlain) <= maxWidth) {
        const candidateStyled = [
          ...leftItems.map((it) => it.styled),
          markerStyled,
          ...rightItems.map((it) => it.styled),
        ].filter(Boolean).join(sep);
        return candidateStyled;
      }
    }
  }

  // Fallback for extremely constrained terminal widths: show single active or first tab truncated.
  const fallbackItem = activeIdx >= 0 ? items[activeIdx] : items[0];
  return fitCells(fallbackItem.styled, maxWidth, { pad: false });
}

/**
 * Builds the bottom chrome block: session tab row plus status footer line.
 * Drops the footer first on short terminals (<= 8 rows), and drops both on tiny terminals (<= 6 rows)
 * to prevent eating user input lines.
 *
 * @param {{
 *   session?: any,
 *   sessions?: Array<any>,
 *   activeId?: string|number|null,
 *   colors?: any,
 *   width?: number,
 *   rows?: number|null,
 *   footer?: any,
 * }} [options]
 * @returns {Array<string>}
 */
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
  if (termRows !== null && termRows <= 8) {
    return tab ? [tab] : [];
  }

  let foot = "";
  if (footer != null) {
    foot = typeof footer === "function" ? String(footer() || "") : String(footer || "");
  } else if (session != null) {
    foot = String(composerFooter(session, colors, width) || "");
  }

  return [tab, foot].filter((line) => typeof line === "string" && line.trim().length > 0).slice(0, 2);
}

/**
 * Resolves a target session from a /tabs switch query.
 * Supports 1-based index, exact name, exact id, unique prefix name, and unique prefix id.
 * Refuses ambiguous matches rather than guessing to avoid accidental state switching.
 *
 * @param {Array<any>} sessions
 * @param {any} args
 * @returns {any}
 */
export function tabsToSwitch(sessions, args) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  const raw = Array.isArray(args) ? args.join(" ").trim() : String(args ?? "").trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const idx = Number.parseInt(raw, 10);
    if (idx >= 1 && idx <= sessions.length) {
      return sessions[idx - 1] ?? null;
    }
    return null;
  }

  const query = raw.toLowerCase().replace(/^@/, "");
  const getSessionName = (s) => clean(s?.name || s?.agentSession?.name || "").toLowerCase().replace(/^@/, "");
  const getSessionId = (s) => String(s?.id || s?.agentSession?.id || "").toLowerCase();

  const exactNameMatches = sessions.filter((s) => getSessionName(s) === query);
  if (exactNameMatches.length === 1) return exactNameMatches[0];
  if (exactNameMatches.length > 1) return null;

  const exactIdMatches = sessions.filter((s) => getSessionId(s) === query);
  if (exactIdMatches.length === 1) return exactIdMatches[0];
  if (exactIdMatches.length > 1) return null;

  const prefixNameMatches = sessions.filter((s) => getSessionName(s).startsWith(query));
  if (prefixNameMatches.length === 1) return prefixNameMatches[0];
  if (prefixNameMatches.length > 1) return null;

  const prefixIdMatches = sessions.filter((s) => getSessionId(s).startsWith(query));
  if (prefixIdMatches.length === 1) return prefixIdMatches[0];
  if (prefixIdMatches.length > 1) return null;

  return null;
}

// Pure decision logic and formatting for mouse click hints in the TUI panel.
// Informs users when a click in an interactive-looking region (tab rail or tab row)
// fails to resolve to an active tab, while keeping the transcript area quiet for text selection.

export const CLICK_HINT_TEXT = "Only session tabs are clickable; click a tab to switch.";

/**
 * Formats a single transcript hint line explaining what is clickable.
 * Uses muted tone when colors are available so it does not distract from transcript prose.
 *
 * @param {{ dim?: string, reset?: string }} [colors]
 * @returns {string}
 */
export function formatClickHint(colors = {}) {
  const dim = colors?.dim || "";
  const reset = dim ? (colors?.reset || "") : "";
  return `${dim}${CLICK_HINT_TEXT}${reset}`;
}

/**
 * Checks whether coordinate point falls inside an interactive region.
 *
 * Regions that look interactive:
 * 1. Tab rail column (vertical mode): x in [0, railWidth), y in [0, viewRows).
 * 2. Tab row band (horizontal mode): y === tabRowY, x in [0, cols).
 *
 * Clicks in the transcript area (y < viewRows and outside the rail column) are exempt
 * because users frequently click or drag to select terminal text, and emitting a hint
 * there would create visual noise during normal selection.
 *
 * @param {{ x: number, y: number }} point
 * @param {{ railWidth?: number, tabRowY?: number, viewRows?: number, cols?: number }} [geometry]
 * @returns {boolean}
 */
export function isInteractiveRegion(point, geometry = {}) {
  if (!point || typeof point !== "object") return false;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  const railWidth = Math.max(0, Number(geometry?.railWidth) || 0);
  const viewRows = Math.max(0, Number(geometry?.viewRows) || 0);
  const tabRowY = typeof geometry?.tabRowY === "number" ? geometry.tabRowY : -1;
  const cols = Math.max(0, Number(geometry?.cols) || 80);

  // Vertical rail column: user clicked inside the tab column area.
  if (railWidth > 0) {
    return x >= 0 && x < railWidth && y >= 0 && y < viewRows;
  }

  // Horizontal tab row: user clicked along the tab row band.
  if (tabRowY >= 0 && y === tabRowY) {
    return x >= 0 && x < cols;
  }

  return false;
}

/**
 * Pure decision: should a click hint be displayed?
 *
 * Conditions:
 * - Must be a click event.
 * - Target tab must be null (a miss).
 * - Screen loop must not be suspended (prevents hints while a modal prompt owns the terminal).
 * - Rate limit: hintCount must be 0 (at most one hint per session to avoid nag spam).
 * - Click coordinate must be in an interactive region (rail column or tab row band).
 *
 * @param {{
 *   event?: any,
 *   geometry?: any,
 *   targetId?: string | null,
 *   hintCount?: number,
 *   suspended?: boolean,
 * }} [params]
 * @returns {boolean}
 */
export function shouldShowClickHint({
  event,
  geometry,
  targetId = null,
  hintCount = 0,
  suspended = false,
} = {}) {
  // Only click events can produce a click hint.
  if (!event || event.kind !== "click") return false;

  // Never write hints while the panel is suspended for a modal command or prompt.
  if (suspended) return false;

  // Rate-limit to at most one hint per session to prevent repeated click noise.
  if (hintCount > 0) return false;

  // If a tab resolved, this is a successful switch, not a miss.
  if (targetId) return false;

  // Transcript clicks and other non-interactive areas must remain silent.
  if (!isInteractiveRegion({ x: event.x, y: event.y }, geometry)) return false;

  return true;
}

// Panel geometry, kept out of the screen loop so three features can touch layout without pushing that
// file past the line ratchet. Every number here decides how much terminal a user sees, so the reasoning
// travels with the arithmetic.
import { chromeLines } from "./mso-agent-chrome.mjs";
import { composerSeparator } from "./mso-agent-layout.mjs";
import { paneWidth } from "./mso-agent-pane.mjs";
import { tabRailWidth } from "./mso-agent-chrome.mjs";
import { filterSessionsByScope } from "./mso-agent-session-list.mjs";

/**
 * @param {{
 *   output: any, session: any, colors?: any, getSessions: () => Array<any>,
 *   promptReservation: number, tabsLayout?: string|null, tabsScope?: string|null,
 * }} opts
 */
export function panelGeometry({ output, session, colors = {}, getSessions, promptReservation, tabsLayout = null, tabsScope = null }) {
  const cols = Math.max(20, Number(output.columns) || 80);
  const rows = Math.max(6, Number(output.rows) || 24);

  // Scope filters the session list, but never to a set the user cannot navigate back from.
  const list = getSessions();
  const scope = tabsScope || session?.tabsScope || session?.tabScope || "global";
  const targetCwd = session?.cwd || session?.agentSession?.cwd || (typeof process !== "undefined" ? process.cwd?.() : "");
  const scoped = scope !== "cwd" ? list : filterSessionsByScope(list, { scope, cwd: targetCwd, activeId: session?.agentSession?.id });

  // A vertical rail and a bottom row are the same list; the rail wins when it fits, and when it does
  // not the row takes over so session switching is never lost.
  const isVertical = (tabsLayout || session?.tabsLayout || session?.tabLayout) === "vertical";
  const railWidth = isVertical ? tabRailWidth(cols) : 0;
  const chrome = chromeLines({ session, sessions: railWidth > 0 ? [] : scoped, activeId: session.agentSession?.id, colors, width: cols, rows: null });

  const separator = composerSeparator(session, colors, cols);
  const hasSep = typeof separator === "string" && separator.length > 0;
  // The separator belongs to the panel in this mode; the composer is told to draw none.
  const panel = [hasSep ? separator : "", ...chrome].filter((line) => line.length > 0);
  const viewRows = Math.max(0, rows - panel.length - promptReservation);
  const tabRowY = railWidth > 0 ? -1 : viewRows + (hasSep ? 1 : 0);

  const kind = session?.paneKind && session.paneKind !== "off" ? session.paneKind : null;
  // The threshold is configurable so a narrow terminal can still have a pane.
  const pWidth = kind ? paneWidth(cols, { minColumns: session?.paneMinColumns ?? 100 }) : 0;
  const transWidth = cols - pWidth - railWidth;
  return { cols, rows, panel, viewRows, tabRowY, pWidth, transWidth, railWidth, kind, promptRows: promptReservation, sessions: scoped };
}

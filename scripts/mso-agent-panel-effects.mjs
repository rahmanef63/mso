// Side effects the panel runs on sync and on click, kept apart from the paint loop so that file stays
// under the line ratchet and so each effect has one obvious home.
import { createPrinter } from "./mso-agent-print.mjs";
import { formatClickHint, shouldShowClickHint } from "./mso-agent-click-hint.mjs";

/**
 * A bounded MCP refresh: at most once in flight, never on paint, and a failure keeps the previous list
 * rather than blanking a pane that was already correct.
 */
export function createMcpRefresher({ session, getRefresh, onUpdated }) {
  let inFlight = false;
  return () => {
    const fn = getRefresh();
    if (typeof fn !== "function" || inFlight) return;
    inFlight = true;
    Promise.resolve(fn())
      .then((next) => { if (Array.isArray(next)) { session.mcpServers = next; onUpdated(); } })
      .catch(() => {})
      .finally(() => { inFlight = false; });
  };
}

/**
 * Tracks the one-shot click hint. State lives here rather than in the loop so the loop does not need a
 * counter, and so the rule (once per session, interactive regions only) is testable on its own.
 */
export function createClickHintReporter({ session, colors }) {
  let emitted = 0;
  return ({ event, geometry, targetId, suspended }) => {
    if (!shouldShowClickHint({ event, geometry, targetId, hintCount: emitted, suspended })) return false;
    emitted += 1;
    createPrinter({ session, colors }).print(formatClickHint(colors));
    return true;
  };
}

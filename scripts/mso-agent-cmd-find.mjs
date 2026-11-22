// Command handler for /find: locates transcript text and scrolls viewport.
import { C } from "./mso-agent-runtime.mjs";
import { createPrinter } from "./mso-agent-print.mjs";
import { getAllLines } from "./mso-agent-viewport.mjs";
import { transcriptLines } from "./mso-agent-transcript.mjs";
import { findMatches, offsetForLine } from "./mso-agent-find.mjs";

/**
 * Resolves the transcript lines to search across.
 * Viewport buffer lines take precedence when present to match visible rows.
 * Falls back to deriving transcript lines from session history.
 *
 * @param {object} session - Active session object.
 * @param {object} viewport - Viewport instance.
 * @returns {string[]} Lines of text.
 */
export function getSearchLines(session, viewport) {
  if (viewport) {
    const lines = getAllLines(viewport);
    if (lines.length > 0) return lines;
  }
  if (session) {
    return transcriptLines(session, { colors: session?.colors });
  }
  return [];
}

/**
 * Handles /find slash command:
 * - /find <query>: searches transcript, reports matches, jumps to first match.
 * - /find: reports match count for previous query or prompts for a query.
 * - /find --next (or repeated query): jumps to next match and wraps.
 *
 * @param {object} ctx - Command execution context.
 * @param {string[]} [args] - Command arguments.
 * @returns {Promise<string>} Handled status.
 */
export async function handleFindCommand(ctx, args = []) {
  const session = ctx?.session ?? ctx;
  const viewport = ctx?.viewport ?? ctx?.session?.screenLoop?.viewport ?? ctx?.session?.viewport;
  const colors = ctx?.C ?? ctx?.colors ?? C ?? {};
  const { print } = ctx?.printer ?? createPrinter(ctx);
  const { cyan = "", reset = "", dim = "" } = colors;

  const rawQuery = Array.isArray(args) ? args.join(" ").trim() : "";
  const sub = args[0]?.toLowerCase();
  const isNextFlag = sub === "--next" || sub === "-n";

  // Case 1: Bare /find with no argument
  if (!args.length) {
    const state = session?._findState;
    if (!state?.query) {
      print("no previous query: use /find <query>");
      return "handled";
    }
    const lines = getSearchLines(session, viewport);
    const matches = findMatches(lines, state.query);
    if (matches.length === 0) {
      print(`0 matches for "${state.query}"`);
      return "handled";
    }
    const current = Math.min(state.matchIndex, matches.length - 1);
    const lineNum = matches[current] + 1;
    const countLabel = `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
    print(`${cyan}${countLabel}${reset} for "${state.query}"${dim} (at match ${current + 1}/${matches.length}, line ${lineNum})${reset}`);
    return "handled";
  }

  // Case 2: Explicit /find --next to advance
  if (isNextFlag) {
    const state = session?._findState;
    if (!state?.query) {
      print("no previous query: use /find <query>");
      return "handled";
    }
    const lines = getSearchLines(session, viewport);
    const matches = findMatches(lines, state.query);
    if (matches.length === 0) {
      print(`0 matches for "${state.query}"`);
      return "handled";
    }
    state.matchIndex = (state.matchIndex + 1) % matches.length;
    state.matches = matches;
    const targetLine = matches[state.matchIndex];
    if (viewport) {
      viewport.offset = offsetForLine(viewport, targetLine);
      session?.screenLoop?.paint?.();
    }
    const countLabel = `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
    print(`${cyan}${countLabel}${reset} for "${state.query}"${dim} (match ${state.matchIndex + 1}/${matches.length}, line ${targetLine + 1})${reset}`);
    return "handled";
  }

  // Case 3: Empty query (e.g. /find "" or whitespace)
  if (!rawQuery) {
    print("empty query: use /find <query>");
    return "handled";
  }

  // Case 4: Search for query, moving to next match if query is repeated
  const lines = getSearchLines(session, viewport);
  const matches = findMatches(lines, rawQuery);

  if (matches.length === 0) {
    print(`0 matches for "${rawQuery}"`);
    return "handled";
  }

  const prior = session?._findState;
  const isRepeated = prior?.query?.toLowerCase() === rawQuery.toLowerCase();
  let nextIndex = 0;
  if (isRepeated && typeof prior?.matchIndex === "number") {
    // Advance to next match and wrap when repeating same query
    nextIndex = (prior.matchIndex + 1) % matches.length;
  } else {
    // Fresh query jumps to first match
    nextIndex = 0;
  }

  if (session) {
    session._findState = {
      query: rawQuery,
      matchIndex: nextIndex,
      matches,
    };
  }

  const targetLine = matches[nextIndex];
  if (viewport) {
    viewport.offset = offsetForLine(viewport, targetLine);
    session?.screenLoop?.paint?.();
  }

  const countLabel = `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
  print(`${cyan}${countLabel}${reset} for "${rawQuery}"${dim} (match ${nextIndex + 1}/${matches.length}, line ${targetLine + 1})${reset}`);
  return "handled";
}

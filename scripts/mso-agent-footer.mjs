// The prompt footer, arranged the way a coding agent's status line is usually arranged.
//
// Two rows, because one row cannot hold six facts without becoming a wall of dots:
//
//   row 1  mode · model · thinking        what this turn will do
//   row 2  dir · tokens · context · ^P    where it is, how full the window is, and how to ask for more
//
// Every value here comes from the session. Nothing is inferred: a field the session does not carry is
// omitted rather than printed as a placeholder, because "ctx ~0/?" claims a measurement that was never
// taken.

import { contextStatus } from "./mso-agent-status.mjs";
import { queueList } from "./mso-agent-queue.mjs";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";

const width = (value) => cellWidth(value);

// Clips to `max` cells by measuring the PLAIN text and then applying the colour once.
//
// Slicing the styled string cut escape sequences in half: the cut landed inside "\x1b[2m" and the "…" that
// followed was not a CSI final byte, so the terminal kept buffering and ate the next real characters. It
// also emitted no reset, which bled dim/yolo colour into the prompt. Measuring in cells (not code points)
// is the second half of the fix: a CJK path is twice as wide as its character count says.
const clamp = (value, max) => {
  const plainText = stripAnsi(value);
  if (cellWidth(plainText) <= max) return String(value ?? "");
  let out = "", used = 0;
  for (const ch of plainText) {
    const w = cellWidth(ch);
    if (used + w > Math.max(0, max - 1)) break;
    out += ch;
    used += w;
  }
  return `${out}…`;
};

function number(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function compact(value) {
  const n = number(value);
  if (n === null) return null;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

// Shortens the home directory to ~ so the row stays about the project, not about the user.
function shortPath(value) {
  const path = String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path) return "";
  const home = String(process.env.HOME || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (home && path.startsWith(home)) return `~${path.slice(home.length)}` || "~";
  return path;
}

const MODE_TONE = { yolo: "err", "auto-write": "warn", auto: "warn", ask: "c" };

/**
 * The two footer rows, already coloured and clipped to the terminal width.
 *
 * @param {{session: any, colors?: any, columns?: number}} options
 * @returns {[string, string]} top and bottom rows
 */
export function footerRows({ session, colors = {}, columns = 100 } = {}) {
  const cols = Math.max(20, Number(columns) || 100);
  const dim = colors.dim || "", reset = colors.reset || "", bold = colors.bold || "", c = colors.c || colors.cyan || "";
  const warn = colors.warn || "";
  const tone = colors[MODE_TONE[String(session?.permission || "ask")]] || c;

  const mode = String(session?.permission || "ask");
  // Thinking is a real switch the session carries, so it is stated rather than assumed.
  const thinking = session?.showReasoning === false ? "off" : "on";
  const provider = String(session?.state?.config?.provider || "").trim();
  const model = String(session?.state?.config?.model || "").trim();
  const modelText = [provider, model].filter(Boolean).join("/");

  const topParts = [`${tone}${bold}${mode}${reset}`];
  if (modelText) topParts.push(`${dim}${modelText}${reset}`);
  topParts.push(`${dim}thinking ${thinking}${reset}`);
  const top = clamp(topParts.join(`${dim}  ·  ${reset}`), cols);

  // The window is modelMeta.context, which is what contextStatus() reads. Asking for contextWindow
  // silently produced no percentage at all, so the footer showed no context line on a session that had
  // one. The estimate comes from contextStatus so this row and /status can never disagree.
  const ctx = contextStatus(session?.history, session?.state?.modelMeta);
  // Only claim a context reading when there is something to measure: usage or history. Otherwise the row
  // would print "context 0%", which asserts a window and an occupancy nobody measured.
  const measured = (ctx.used ?? 0) > 0 || (session?.history?.length ?? 0) > 0;
  const pct = !measured ? null : ctx.limit ? `context ${ctx.percent}%` : `context ${compact(ctx.used)}`;
  const tokens = compact(session?.usage?.totalTokens) ?? (
    number(session?.usage?.inputTokens) !== null && number(session?.usage?.outputTokens) !== null
      ? `${compact(session.usage.inputTokens)}/${compact(session.usage.outputTokens)}`
      : null
  );

  const bottomParts = [];
  const dir = shortPath(session?.cwd || process.cwd());
  if (dir) bottomParts.push(`${dim}${dir}${reset}`);
  if (tokens !== null) bottomParts.push(`${dim}${tokens} tokens${reset}`);
  if (pct) bottomParts.push(`${dim}${pct}${reset}`);
  // Queued prompts are held in memory and drained per turn. Showing the count is the only way a user can
  // see that their follow-up was accepted, and it must not reorder anything.
  const queued = queueList(session?.queue).length;
  if (queued) bottomParts.push(`${warn}${queued} queued${reset}`);
  bottomParts.push(`${dim}^P commands${reset}`);
  const bottom = clamp(bottomParts.join(`${dim}  ·  ${reset}`), cols);

  return [top, bottom];
}

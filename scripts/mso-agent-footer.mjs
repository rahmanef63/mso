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

const PLAIN = /\x1b\[[0-9;]*m/g;
const plain = (value) => String(value ?? "").replace(PLAIN, "");
const width = (value) => Array.from(plain(value)).length;
const clamp = (value, max) => {
  const text = String(value ?? "");
  if (width(text) <= max) return text;
  const chars = Array.from(text);
  return `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
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

  const used = number(session?.usage?.promptTokens) ?? number(session?.usage?.totalTokens)
    ?? number(session?.usage?.inputTokens) ?? number(session?.state?.modelMeta?.estimatedTokens) ?? null;
  const limit = number(session?.state?.modelMeta?.contextWindow) ?? number(session?.state?.modelMeta?.contextTokens) ?? null;
  const ctx = used === null ? null : limit === null ? `context ${compact(used)}` : `context ${Math.round((used / limit) * 100)}%`;
  const tokens = compact(session?.usage?.totalTokens) ?? (
    number(session?.usage?.inputTokens) !== null && number(session?.usage?.outputTokens) !== null
      ? `${compact(session.usage.inputTokens)}/${compact(session.usage.outputTokens)}`
      : null
  );

  const bottomParts = [];
  const dir = shortPath(session?.cwd || process.cwd());
  if (dir) bottomParts.push(`${dim}${dir}${reset}`);
  if (tokens !== null) bottomParts.push(`${dim}${tokens} tokens${reset}`);
  if (ctx) bottomParts.push(`${dim}${ctx}${reset}`);
  bottomParts.push(`${dim}^P commands${reset}`);
  const bottom = clamp(bottomParts.join(`${dim}  ·  ${reset}`), cols);

  return [top, bottom];
}

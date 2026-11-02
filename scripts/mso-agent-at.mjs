// The @ completion source for the prompt.
//
// Two triggers share one prompt but not one namespace:
//   /  commands and skills, prefix anchored at the start of the line
//   @  the things you address: another agent, or an MCP server whose tools this turn may use
//
// The list is mixed and every row carries its kind, so the menu can say `agent` or `plugin` instead of
// leaving the user to infer it. Files are deliberately absent: MSO has no file-mention consumer, and a
// menu row that inserts a token nothing reads is decoration.
//
// Trigger shape follows what opencode proved: `@` opens only at the start of the line or after
// whitespace, and the query ends at the first whitespace. That is why `/` and `@` never fight for the
// same token, and why a trailing comma or bracket does not break matching.

const TRIGGER = /(^|\s)@([^\s]*)$/;

/**
 * Locates an in-progress @ token at the cursor.
 * @param {string} text whole prompt line
 * @param {number} cursor caret offset
 * @returns {{start: number, query: string} | null} start is the index of "@"
 */
export function atTrigger(text, cursor = String(text ?? "").length) {
  const before = String(text ?? "").slice(0, Math.max(0, Math.min(cursor, String(text ?? "").length)));
  const match = before.match(TRIGGER);
  if (!match) return null;
  // A slash command owns the line: `@` inside `/find @foo` must not open this menu.
  if (/^\s*\//.test(before)) return null;
  const start = before.length - match[2].length - 1;
  return { start, query: match[2] };
}

function online(agent) {
  return !["offline", "ended"].includes(String(agent?.status ?? "").toLowerCase());
}

/**
 * Items for the @ menu.
 *
 * Agents come from the live local session directory, so the menu can say whether the target can
 * actually receive anything. A row that would silently queue is marked, not hidden: hiding it makes the
 * agent look absent, which is a different and more confusing lie.
 *
 * Plugins come from the MCP server list. Per the research, `@` addresses a *server*, never an
 * individual tool: the model picks tools, the user picks the scope.
 *
 * @param {{agents?: Array<any>, mcpServers?: Array<any>}} sources
 * @param {string} query text after the @
 * @returns {Array<{text: string, label: string, meta: string, kind: string}>}
 */
export function atItems({ agents = [], mcpServers = [] } = {}, query = "") {
  const wanted = String(query ?? "").toLowerCase();
  const items = [];

  for (const agent of Array.isArray(agents) ? agents : []) {
    const id = String(agent?.name || agent?.label || agent?.id || "").trim();
    if (!id) continue;
    const live = online(agent);
    items.push({
      text: `@${id}`,
      label: `@${id}`,
      meta: live ? "agent · live" : "agent · offline, message will queue",
      kind: "agent",
    });
  }

  for (const server of Array.isArray(mcpServers) ? mcpServers : []) {
    const id = String(server?.name || server?.id || "").trim();
    if (!id) continue;
    const count = typeof server?.toolCount === "number" ? server.toolCount : Array.isArray(server?.tools) ? server.tools.length : null;
    const tools = count === null ? "" : ` · ${count} tool${count === 1 ? "" : "s"}`;
    items.push({
      text: `@${id}`,
      label: `@${id}`,
      meta: `plugin · mcp${tools}`,
      kind: "plugin",
    });
  }

  const seen = new Set();
  return items
    .filter((item) => {
      if (wanted && !item.text.toLowerCase().includes(wanted)) return false;
      // Agents win a name collision: addressing a person is the action with a side effect.
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    })
    .sort((a, b) => (a.kind === b.kind ? a.text.localeCompare(b.text) : a.kind === "agent" ? -1 : 1));
}

const AGENT_OR_PLUGIN = /@([^\s@]+)/g;

/**
 * Splits a submitted line into the addresses it carries and the text that remains.
 *
 * Unknown tokens are left in the text rather than stripped: `@someone` that matches nothing is a typo or
 * an agent that has not started yet, and silently deleting it would send a prompt the user did not write.
 *
 * @param {string} line submitted prompt
 * @param {{agents?: Array<any>, mcpServers?: Array<any>}} sources
 * @returns {{agents: Array<any>, plugins: Array<any>, unknown: string[], text: string}}
 */
export function resolveMentions(line, sources = {}) {
  const known = atItems(sources, "");
  const byText = new Map(known.map((item) => [item.text.toLowerCase(), item]));
  const agents = [], plugins = [], unknown = [];
  const text = String(line ?? "").replace(AGENT_OR_PLUGIN, (whole, token) => {
    const item = byText.get(`@${token}`.toLowerCase());
    if (!item) {
      // Keep it in the prompt, but record it so the caller can say it matched nothing.
      unknown.push(token);
      return whole;
    }
    if (item.kind === "plugin") { plugins.push({ name: token, item }); return whole; }
    agents.push({ name: token, item });
    return whole;
  });
  return { agents, plugins, unknown, text };
}

/**
 * Applies a completion item to the prompt line.
 *
 * A slash command replaces the line because it IS the line. An @ token may sit mid sentence, so it
 * replaces only itself and keeps the words around it. Kept here, beside the trigger, so the rule is
 * tested with the parsing that produces it rather than buried in the composer's key handler.
 *
 * @param {string} value current prompt
 * @param {number} cursor caret offset
 * @param {{text: string, replaceFrom?: number}} item chosen menu row
 * @returns {{value: string, cursor: number}}
 */
export function applyCompletion(value, cursor, item) {
  const text = String(value ?? "");
  if (!Number.isInteger(item?.replaceFrom)) {
    const next = String(item?.text ?? "");
    return { value: next, cursor: Array.from(next).length };
  }
  const next = `${text.slice(0, item.replaceFrom)}${item.text} ${text.slice(cursor).trimStart()}`.trimEnd();
  // The caret lands right after the inserted token, not at the end of the prompt: the user usually
  // keeps typing where they were, and jumping to the end would move the cursor out from under them.
  return { value: next, cursor: Array.from(`${text.slice(0, item.replaceFrom)}${item.text}`).length };
}

/**
 * Tool filter for a turn addressed to a plugin.
 *
 * The model still chooses which tool to call; @plugin only decides which servers are on the table for
 * that turn. Naming one server must never grant a tool outside it, so this filters by name prefix and
 * returns undefined when the turn is unscoped, which the caller reads as "no restriction".
 *
 * @param {Array<{name: string}>} plugins servers named by @
 * @param {Array<any>} tools tools available to the session
 * @returns {((tool: any) => boolean) | null} predicate, or null when unscoped
 */
export function pluginToolFilter(plugins, tools = []) {
  const names = (Array.isArray(plugins) ? plugins : []).map((p) => String(p?.name ?? p ?? "")).filter(Boolean);
  if (!names.length) return null;
  // Only claim a prefix that some tool actually carries. Otherwise @unknown would silently disable
  // every tool and the turn would fail for a reason nobody could see.
  const prefixes = names
    .map((name) => `${name}__`)
    .filter((prefix) => (Array.isArray(tools) ? tools : []).some((tool) => String(tool?.name ?? "").startsWith(prefix)));
  if (!prefixes.length) return null;
  return (tool) => prefixes.some((prefix) => String(tool?.name ?? "").startsWith(prefix));
}

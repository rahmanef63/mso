// Routes the prompt's single completion callback to the right trigger.
//
// The composer takes one `complete` function, which is why / and @ have to share it. Routing is decided
// by position, not by preference: a slash command owns the whole line, so `@` inside `/find @foo`
// completes nothing rather than trying to address an agent.
import { atItems, atTrigger } from "./mso-agent-at.mjs";
import { listLocalAgents } from "./mso-agent-local-directory.mjs";
import { fetchMcpServers } from "./mso-agent-mcp-servers.mjs";

/**
 * @param {{ slash?: (line: string) => Array<any>, sources?: () => {agents?: Array<any>, mcpServers?: Array<any>} }} options
 * @returns {(line: string) => Array<any>}
 */
export function promptCompletion({ slash, sources = () => ({}) } = {}) {
  return (line) => {
    const text = String(line ?? "");
    const trigger = atTrigger(text);
    if (!trigger) return typeof slash === "function" ? slash(text) || [] : [];
    // A menu item is inserted as the whole token, so the completed text replaces the partial "@qu".
    const snapshot = sources() || {};
    return atItems(snapshot, trigger.query).map((item) => ({
      ...item,
      // The composer appends the chosen item's text, so the token must already carry its "@".
      text: item.text,
      replaceFrom: trigger.start,
    }));
  };
}

/**
 * Builds the completion callback the composer takes, and the directory refresh that keeps it current.
 *
 * Wired here rather than inline in the entrypoint because the entrypoint is at its line ceiling, and
 * because the two things it owns belong together: what the menu shows, and when that view is refreshed.
 *
 * @param {{session: any, recentSessions: () => Array<any>, slashCompletionItems: any}} deps
 */
export function createPromptCompletion({ session, recentSessions, slashCompletionItems }) {
  let directory = [];
  const complete = promptCompletion({
    slash: (line) => slashCompletionItems(session.state.skills, line, process.cwd(), session, { settings: true, sessions: recentSessions }),
    sources: () => ({ agents: directory, mcpServers: session.mcpServers }),
  });
  // Once per prompt, before the menu can open: the agent directory is the only source that changes
  // while the user sits here, and fetching per keystroke would make the menu stutter.
  // Both sources are refreshed off the keystroke path. MCP servers connect and disconnect during a
  // session, so a list captured at startup would leave @ offering a plugin that is already gone.
  complete.refresh = async () => {
    const [rows, servers] = await Promise.all([
      listLocalAgents(session).catch(() => []),
      fetchMcpServers().catch(() => null),
    ]);
    directory = rows;
    if (Array.isArray(servers)) session.mcpServers = servers;
  };
  // A menu headed "commands & skills" over a list of agents is a small lie that teaches distrust.
  complete.label = (v) => (String(v).trimStart().startsWith("/") ? "commands & skills" : "agents & plugins");
  return complete;
}

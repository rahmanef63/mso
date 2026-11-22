// The live agent directory, kept separate from the command that prints it.
//
// The @ menu needs the same rows /agents shows, but it must never await a network call inside a
// keystroke handler: a menu that stalls while you type is worse than a menu that is one prompt stale.
// So the caller refreshes this between prompts and the completion source reads the snapshot.
import { api } from "./mso-agent-api.mjs";

/**
 * @param {any} session active session, used for its id
 * @param {{includeOffline?: boolean, request?: any}} [options]
 * @returns {Promise<Array<any>>} agents, or an empty list when the directory is unreachable
 */
export async function listLocalAgents(session, { includeOffline = true, request = api } = {}) {
  const id = session?.agentSession?.id;
  if (!id) return [];
  const query = new URLSearchParams({ session: id });
  if (includeOffline) query.set("includeOffline", "1");
  try {
    const out = await request(`/api/v1/local-agents?${query}`);
    return Array.isArray(out?.agents) ? out.agents : [];
  } catch {
    // A failed directory lookup must not break the prompt: the menu simply offers plugins only.
    return [];
  }
}

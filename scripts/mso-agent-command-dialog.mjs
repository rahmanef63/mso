// Ctrl+P: a command dialog, the way a coding agent usually offers one.
//
// Why a dialog and not just typing `/`: the slash menu only opens when the line STARTS with `/`, which
// means a user who is halfway through a sentence cannot reach a command without clearing what they wrote.
// Ctrl+P opens the same registry over whatever is already there, and choosing something runs it.
import { createPrinter } from "./mso-agent-print.mjs";

const PLAIN = /\x1b\[[0-9;]*m/g;

/**
 * Builds the rows the dialog lists. One source, so the dialog can never offer a command the handler
 * does not know.
 *
 * @param {Array<{name: string, usage?: string, description?: string}>} commands manifest entries
 * @returns {Array<{text: string, label: string, meta: string, kind: string}>}
 */
export function commandDialogItems(commands = []) {
  return (Array.isArray(commands) ? commands : [])
    .filter((row) => row && typeof row.name === "string" && row.name.startsWith("/"))
    .map((row) => ({
      text: row.usage ? `${row.name} ${row.usage}` : row.name,
      label: row.name,
      meta: String(row.description || "").replace(PLAIN, ""),
      kind: "command",
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Opens the dialog and returns the chosen line, or null when dismissed.
 *
 * The answer is returned rather than executed here: the caller already owns the dispatch path, and a
 * second dispatch would be a second place to keep in step with the manifest.
 *
 * @param {{rl: any, session: any, commands: Array<any>}} deps
 * @returns {Promise<string|null>}
 */
export async function commandDialog({ rl, session, commands }) {
  const items = commandDialogItems(commands);
  if (!items.length) {
    createPrinter({ session }).print("no commands available");
    return null;
  }
  const answer = await rl.question("⌘ › ", {
    history: false,
    complete: (value) => {
      const query = String(value ?? "").trim().toLowerCase();
      return items.filter((item) => !query || item.label.toLowerCase().includes(query) || item.meta.toLowerCase().includes(query));
    },
    panelLabel: "commands",
    selectOnEnter: true,
    escapeCancels: true,
  });
  return answer?.trim() ? answer.trim() : null;
}

/**
 * Runs the dialog when Ctrl+P asked for it, and reports what to do next.
 *
 * Returns the chosen line to dispatch, "continue" to re-prompt, or null to fall through to the normal
 * answer handling. Kept here so the entrypoint keeps one branch instead of three.
 *
 * @param {{requested: boolean, rl: any, session: any, commands: Array<any>}} input
 * @returns {Promise<{chosen?: string, again?: boolean} | null>}
 */
export async function takeCommandRequest({ requested, rl, session, commands }) {
  if (!requested) return null;
  const chosen = await commandDialog({ rl, session, commands });
  return chosen ? { chosen } : { again: true };
}

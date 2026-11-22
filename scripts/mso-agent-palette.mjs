import { stateOf } from "./mso-agent-session-list.mjs";
import { clean } from "./tui/cells.mjs";

// Evaluates candidate relevance against normalized query string.
// Rank 1: Prefix on name.
// Rank 2: Substring on name (non-prefix).
// Rank 3: Substring on description or keywords.
// Returns null when no criteria match.
function matchScore(name, desc, keywords, q) {
  if (!q) return 1;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (desc.includes(q)) return 3;
  if (keywords.some((k) => k.includes(q))) return 3;
  return null;
}

/**
 * @param {{
 *   commands?: Array<any>,
 *   settings?: Array<any> | (() => Array<any>),
 *   sessions?: Array<any> | (() => Array<any>),
 *   query?: string,
 *   colors?: Record<string, string>,
 * }} [options]
 * @returns {Array<any>}
 */
export function paletteItems({
  commands = [],
  settings = [],
  sessions = [],
  query = "",
  colors = {},
} = {}) {
  void colors;
  const raw = String(query ?? "").trim();
  const q = raw.toLowerCase().replace(/^\//, "");

  const commandList = Array.isArray(commands) ? commands : [];
  const settingList = typeof settings === "function" ? settings() : (Array.isArray(settings) ? settings : []);
  const sessionList = typeof sessions === "function" ? sessions() : (Array.isArray(sessions) ? sessions : []);

  const matchingCommands = [];
  for (let idx = 0; idx < commandList.length; idx++) {
    const cmd = commandList[idx];
    if (!cmd || !cmd.text) continue;
    const name = (cmd.name || cmd.text || "").replace(/^\//, "").toLowerCase();
    const desc = String(cmd.meta || cmd.description || "").toLowerCase();
    const keywords = Array.isArray(cmd.keywords) ? cmd.keywords.map((k) => String(k).toLowerCase()) : [];
    const score = matchScore(name, desc, keywords, q);
    if (score !== null) {
      matchingCommands.push({ item: cmd, score, order: 0, idx });
    }
  }

  const matchingSettings = [];
  for (let idx = 0; idx < settingList.length; idx++) {
    const setting = settingList[idx];
    if (!setting || (!setting.key && !setting.name)) continue;
    const key = String(setting.key || setting.name || "");
    const name = key.toLowerCase();
    const desc = String(setting.description || setting.meta || "").toLowerCase();
    const keywords = Array.isArray(setting.keywords) ? setting.keywords.map((k) => String(k).toLowerCase()) : [];
    const score = matchScore(name, desc, keywords, q);
    if (score !== null) {
      // Append a trailing space so the user can inspect or type a value without blind application.
      const item = {
        text: `/settings ${key} `,
        meta: String(setting.description || ""),
        kind: "setting",
      };
      matchingSettings.push({ item, score, order: 1, idx });
    }
  }

  const matchingSessions = [];
  for (let idx = 0; idx < sessionList.length; idx++) {
    const sess = sessionList[idx];
    if (!sess) continue;
    const rawName = clean(sess.name || sess.agentSession?.name || "").replace(/^@/, "");
    const title = clean(sess.title || sess.agentSession?.title || "");
    const stateInfo = stateOf(sess);
    const name = rawName.toLowerCase();
    const desc = `${title} ${stateInfo.label}`.toLowerCase();
    const keywords = [stateInfo.state.toLowerCase(), stateInfo.label.toLowerCase()];
    const score = matchScore(name, desc, keywords, q);
    if (score !== null) {
      const label = `@${rawName || "agent"}`;
      const meta = `${label} · ${stateInfo.label}${title ? ` · ${title}` : ""}`;
      // Sessions switch by 1-based index matching TUI tab row conventions.
      const item = {
        text: `/tabs ${idx + 1}`,
        meta,
        kind: "session",
      };
      matchingSessions.push({ item, score, order: 2, idx });
    }
  }

  // Cap settings and sessions to 5 entries each, preserving score and relative order.
  matchingSettings.sort((a, b) => a.score - b.score || a.idx - b.idx);
  const cappedSettings = matchingSettings.slice(0, 5);

  matchingSessions.sort((a, b) => a.score - b.score || a.idx - b.idx);
  const cappedSessions = matchingSessions.slice(0, 5);

  // Merge and rank: score (1 < 2 < 3), then category (commands < settings < sessions), then input index.
  const merged = [...matchingCommands, ...cappedSettings, ...cappedSessions];
  merged.sort((a, b) => a.score - b.score || a.order - b.order || a.idx - b.idx);

  return merged.map((entry) => entry.item);
}

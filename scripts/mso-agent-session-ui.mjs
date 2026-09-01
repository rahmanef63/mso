import { C, createCliSession, listCliSessions, renameCliSession, resumeCliSession, saveCliSession } from "./mso-agent-runtime.mjs";
import { formatSessionModified, resolveSessionQuery, sessionCompletionItems, sessionPromptHistory, visibleSessionRows } from "./mso-agent-sessions.mjs";

function autoTitle(history) {
  const first = history.find((row) => row?.role === "user" && typeof row.text === "string" && row.text.trim());
  return first ? String(first.text).replace(/[\r\n\t]+/g, " ").trim().slice(0, 100) : undefined;
}

export function syncPromptHistory(rl, session) {
  rl.replaceHistory(sessionPromptHistory(session?.history));
}

export async function persistSession(session) {
  const title = session.titleOverride || autoTitle(session.history);
  const saved = await saveCliSession(session.agentSession, session.history, title);
  session.agentSession = { ...session.agentSession, ...saved };
  if (Array.isArray(saved?.history)) session.history = saved.history;
}

export async function renameCurrentSession(session, title) {
  const nextTitle = String(title || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  if (!nextTitle) throw new Error("session title is required");
  const saved = await renameCliSession(session.agentSession, nextTitle);
  session.agentSession = { ...session.agentSession, ...saved };
  session.titleOverride = saved?.title || nextTitle;
  return session.titleOverride;
}

export function printSessions(rows) {
  if (!rows.length) { console.log("No MSO Agent sessions yet."); return; }
  console.log(`${C.bold}Matching MSO Agent sessions${C.reset}`);
  rows.forEach((row, index) => {
    const title = String(row.title || "MSO Agent session").replace(/[\r\n\t]+/g, " ").trim().slice(0, 72);
    const modified = formatSessionModified(row.updatedAt || row.createdAt);
    console.log(`  ${String(index + 1).padStart(2)}  ${C.blue}${title}${C.reset}  ${C.dim}· modified ${modified}${C.reset}`);
  });
  console.log(`${C.dim}Resume by title or list index; exact ids remain accepted as a scriptable escape hatch.${C.reset}`);
}

async function resolveResume(query, rows = null) {
  const sessions = rows || await listCliSessions(100);
  const result = resolveSessionQuery(sessions, query);
  if (result.session) return result.session;
  if (result.ambiguous?.length) {
    console.log(`${C.warn}resume query is ambiguous:${C.reset}`);
    printSessions(result.ambiguous);
    return null;
  }
  throw new Error(`no resumable MSO Agent session matches: ${query || "latest"}`);
}

export async function resumeInto(rl, session, query, rows = null) {
  const target = await resolveResume(query, rows);
  if (!target) return false;
  const loaded = await resumeCliSession(target.id);
  if (!loaded || loaded.source !== "cli") throw new Error("could not create a CLI continuation session");
  Object.assign(session, {
    agentSession: loaded,
    history: Array.isArray(loaded.history) ? loaded.history : [],
    pendingSkill: null,
    activeSkill: null,
    lastInvokedSkill: null,
    titleOverride: loaded.title || null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
  });
  syncPromptHistory(rl, session);
  console.log(`${C.c}resumed ${loaded.title || "MSO Agent session"}${C.reset} · ${session.history.length} history rows`);
  return true;
}

export async function resumePicker(rl, session) {
  const rows = visibleSessionRows(await listCliSessions(100));
  if (!rows.length) { console.log("No resumable MSO Agent sessions yet."); return false; }
  const answer = await rl.question(`${C.blue}${C.bold}session ›${C.reset} `, {
    history: false,
    complete: (value) => sessionCompletionItems(rows, value, Date.now(), session.agentSession?.id),
    panelLabel: "recent sessions",
    selectOnEnter: true,
    escapeCancels: true,
  });
  return answer?.trim() ? resumeInto(rl, session, answer.trim(), rows) : false;
}

export function resumeArg(argv) {
  if (argv.includes("--continue") || argv.includes("-c")) return "latest";
  let index = argv.indexOf("--resume");
  if (index < 0) index = argv.indexOf("-r");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--resume requires latest, an index, session id, or title query");
  return value;
}

export async function startupSession(requested) {
  if (!requested) return createCliSession();
  const target = await resolveResume(requested, await listCliSessions(100));
  if (!target) throw new Error(`cannot resume ambiguous session query: ${requested}`);
  return resumeCliSession(target.id);
}

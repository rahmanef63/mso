import { C, createCliSession, listCliSessions, loadCliSession, saveCliSession } from "./mso-agent-runtime.mjs";
import { resolveSessionQuery, sessionCompletionItems } from "./mso-agent-sessions.mjs";

function autoTitle(history) {
  const first = history.find((row) => row?.role === "user" && typeof row.text === "string" && row.text.trim());
  return first ? String(first.text).replace(/[\r\n\t]+/g, " ").trim().slice(0, 100) : undefined;
}

export async function persistSession(session) {
  const title = session.titleOverride || autoTitle(session.history);
  const saved = await saveCliSession(session.agentSession, session.history, title);
  session.agentSession = { ...session.agentSession, ...saved };
}

export function printSessions(rows) {
  if (!rows.length) { console.log("No MSO Agent sessions yet."); return; }
  console.log(`${C.bold}Recent MSO Agent sessions${C.reset}`);
  rows.forEach((row, index) => {
    const when = String(row.updatedAt || row.createdAt || "").replace("T", " ").slice(0, 19);
    const title = String(row.title || "MSO Agent session").replace(/[\r\n\t]+/g, " ").slice(0, 48);
    console.log(`  ${String(index + 1).padStart(2)}  ${C.blue}${row.id}${C.reset}  ${C.dim}${when}${C.reset}  ${String(row.historyTurns || 0).padStart(2)}t  ${title}`);
  });
  console.log(`${C.dim}Resume: /resume latest | /resume 2 | /resume <id/title> · CLI: mso --continue / mso --resume <query>${C.reset}`);
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

export async function resumeInto(session, query, rows = null) {
  const target = await resolveResume(query, rows);
  if (!target) return false;
  const loaded = await loadCliSession(target.id);
  if (!loaded || loaded.source !== "cli") throw new Error("session is not a CLI MSO Agent session");
  Object.assign(session, {
    agentSession: loaded,
    history: Array.isArray(loaded.history) ? loaded.history.slice(-48) : [],
    pendingSkill: null,
    activeSkill: null,
    lastInvokedSkill: null,
    titleOverride: loaded.title || null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
  });
  console.log(`${C.c}resumed ${loaded.id}${C.reset} · ${loaded.title || "MSO Agent session"} · ${session.history.length} history rows`);
  return true;
}

export async function resumePicker(rl, session) {
  const rows = await listCliSessions(100);
  if (!rows.length) { console.log("No MSO Agent sessions yet."); return; }
  printSessions(rows.slice(0, 20));
  const answer = await rl.question(`${C.blue}${C.bold}resume ›${C.reset} `, {
    history: false,
    complete: (value) => sessionCompletionItems(rows, value),
  });
  if (answer?.trim()) await resumeInto(session, answer.trim(), rows);
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
  return loadCliSession(target.id);
}

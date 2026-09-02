import { C } from "./mso-agent-runtime.mjs";
import { createCliSession, listCliSessions, loadCliSession, renameCliSession, renameCliSessionName, resumeCliSession, saveCliSession } from "./mso-agent-api.mjs";
import { sessionCompletionItems, sessionPromptHistory, visibleSessionRows } from "./mso-agent-sessions.mjs";

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

export async function renameCurrentSessionName(session, value) {
  const requested = String(value || "").trim();
  if (!requested) throw new Error("session name is required");
  const saved = await renameCliSessionName(session.agentSession, requested);
  session.agentSession = { ...session.agentSession, ...saved };
  return saved?.name || requested;
}


export function applyNewSessionState(session, loaded, requestedTitle = "") {
  Object.assign(session, {
    agentSession: loaded,
    history: Array.isArray(loaded.history) ? loaded.history : [],
    pendingSkill: null,
    activeSkill: null,
    lastInvokedSkill: null,
    titleOverride: requestedTitle ? (loaded.title || requestedTitle) : null,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    lastElapsedMs: 0,
    pendingApproval: null,
  });
  return session;
}

export async function startNewSession(rl, session, title = "") {
  await persistSession(session);
  const requestedTitle = String(title || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 120);
  const loaded = await createCliSession(requestedTitle || undefined);
  if (!loaded || loaded.source !== "cli") throw new Error("could not create a new CLI MSO Agent session");
  applyNewSessionState(session, loaded, requestedTitle);
  syncPromptHistory(rl, session);
  console.log(`${C.c}new session @${loaded.name} · ${loaded.title || "MSO Agent session"}${C.reset}`);
  return true;
}

export async function resumeInto(rl, session, query) {
  const loaded = await resumeCliSession(query);
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
    pendingApproval: null,
  });
  syncPromptHistory(rl, session);
  console.log(`${C.c}resumed @${loaded.name} · ${loaded.title || "MSO Agent session"}${C.reset} · ${session.history.length} history rows`);
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
  return answer?.trim() ? resumeInto(rl, session, answer.trim()) : false;
}

export function resumeArg(argv) {
  if (argv.includes("--continue") || argv.includes("-c")) return "latest";
  let index = argv.indexOf("--resume");
  if (index < 0) index = argv.indexOf("-r");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--resume requires latest, an index, session id, @name, or title query");
  return value;
}

export function restartSessionArg(argv) {
  const index = argv.indexOf("--restart-session");
  if (index < 0) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new Error("--restart-session requires an exact durable session id");
  return value;
}

export async function startupSession(requested, restartSessionId = null) {
  if (restartSessionId) return loadCliSession(restartSessionId);
  return requested ? resumeCliSession(requested) : createCliSession();
}

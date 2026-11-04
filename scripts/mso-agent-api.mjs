import fs from "node:fs";
import process from "node:process";
import { AgentApiError } from "./mso-agent-errors.mjs";

export const BASE = String(process.env.MSO_AGENT_BASE || "http://127.0.0.1:4005").replace(/\/$/, "");
const ORIGIN = String(process.env.MSO_AGENT_ORIGIN || BASE);
const JAR = String(process.env.MSO_AGENT_JAR || "");
export const CLI = String(process.env.MSO_AGENT_CLI || "mso");
export const VERSION = String(process.env.MSO_AGENT_VERSION || "");
// Upper bound for one request. Long enough for a slow local tool call, short enough that a dead server
// cannot freeze the UI forever.
const REQUEST_TIMEOUT_MS = Math.max(1000, Number(process.env.MSO_AGENT_TIMEOUT_MS) || 120_000);

function cookieHeader() {
  if (!JAR) return "";
  let raw = "";
  try { raw = fs.readFileSync(JAR, "utf8"); } catch { return ""; }
  const pairs = [];
  for (let line of raw.split(/\r?\n/)) {
    if (line.startsWith("#HttpOnly_")) line = line.slice("#HttpOnly_".length);
    else if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length >= 7 && cols[5] === "session") pairs.push(`session=${cols[6] ?? ""}`);
  }
  return pairs.join("; ");
}

export function requestHeaders(json = false, initial = undefined) {
  const headers = new Headers(initial || {});
  headers.set("origin", ORIGIN);
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  if (json && !headers.has("content-type")) headers.set("content-type", "application/json");
  return headers;
}

export async function apiResponse(path, init = {}) {
  const method = String(init.method || "GET").toUpperCase();
  let res;
  try {
    // A request with no deadline can hang forever, and Ctrl+C cannot break a pending await, so the TUI
    // froze with no way out. A caller-supplied signal still wins; the timeout only bounds the unbounded.
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    res = await fetch(`${BASE}${path}`, { ...init, signal, headers: requestHeaders(Boolean(init.body), init.headers) });
  } catch (error) {
    if (["AbortError", "TimeoutError"].includes(String(error?.name || ""))) throw error;
    throw new AgentApiError(error instanceof Error ? error.message : "transport failure", {
      path, method, requestDispatched: false, cause: error,
    });
  }
  if (!res.ok) {
    // The server's own sentence beats "HTTP 500". Only an `{error}` object was read, so an HTML or plain
    // text error page — which is exactly what a proxy or a crashed handler returns — was replaced by the
    // status code, hiding the reason from the user.
    let text = "";
    try { text = await res.text(); } catch { text = ""; }
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const serverMessage = typeof body === "object" && body
      ? String(body.error ?? body.message ?? "")
      : String(body ?? "").trim().slice(0, 300);
    throw new AgentApiError(
      serverMessage ? `${serverMessage} · HTTP ${res.status}` : `HTTP ${res.status}`,
      { status: res.status, path, method, requestDispatched: true },
    );
  }
  return res;
}

export async function api(path, init = {}) {
  const res = await apiResponse(path, init);
  let text = "";
  try {
    text = await res.text();
  } catch (error) {
    // A body that dies mid-read happens AFTER the request was dispatched. Reporting it as a plain failure
    // let a write-scope caller think nothing happened and retry, which is how a double write occurs.
    throw new AgentApiError(`response body dropped after dispatch${error?.message ? `: ${error.message}` : ""}`, {
      path, method: String(init?.method || "GET").toUpperCase(), requestDispatched: true, cause: error,
    });
  }
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}

export async function state() {
  const config = await api("/api/config");
  const provider = encodeURIComponent(String(config?.provider || ""));
  const [toolsData, skills, infra, modelData] = await Promise.all([
    api("/api/v1/agent-tools"),
    api("/api/skills").catch(() => ({ skills: [] })),
    api("/api/v1/infra/providers").catch(() => ({ providers: [] })),
    provider ? api(`/api/models?provider=${provider}`).catch(() => ({ models: [] })) : Promise.resolve({ models: [] }),
  ]);
  const tools = Array.isArray(toolsData?.tools) ? toolsData.tools : [];
  const models = Array.isArray(modelData?.models) ? modelData.models : [];
  const modelMeta = models.find((row) => String(row.id) === String(config?.model)) || null;
  return { config, toolsData, tools, skills, infra, models, modelMeta };
}

export async function createCliSession(title = undefined) {
  const out = await api("/api/v1/agent-sessions", {
    method: "POST",
    body: JSON.stringify({ action: "create", cwd: process.cwd(), ...(title ? { title } : {}) }),
  });
  return out.session;
}

export async function loadCliSession(id) {
  const out = await api(`/api/v1/agent-sessions?id=${encodeURIComponent(id)}`);
  return out.session;
}

export async function resumeCliSession(ref) {
  const out = await api("/api/v1/agent-sessions", {
    method: "POST",
    body: JSON.stringify({ action: "resume", ref, cwd: process.cwd() }),
  });
  return out.session;
}

export async function listCliSessions(limit = 20) {
  const out = await api(`/api/v1/agent-sessions?limit=${Math.max(1, Math.min(100, Number(limit) || 20))}`);
  return Array.isArray(out.sessions) ? out.sessions : [];
}

export async function saveCliSession(session, history, title) {
  const out = await api("/api/v1/agent-sessions", {
    method: "POST",
    body: JSON.stringify({ action: "update", id: session.id, history, cwd: process.cwd(), ...(title ? { title } : {}) }),
  });
  return out.session;
}

export async function renameCliSession(session, title) {
  const out = await api("/api/v1/agent-sessions", {
    method: "POST",
    body: JSON.stringify({ action: "rename", id: session.id, title }),
  });
  return out.session;
}

export async function renameCliSessionName(session, name) {
  const out = await api("/api/v1/agent-sessions", {
    method: "POST",
    body: JSON.stringify({ action: "rename-name", id: session.id, name }),
  });
  return out.session;
}

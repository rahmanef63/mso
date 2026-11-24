import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import type {
  AssistantMessage,
  EndpointStatus,
  ThreadRecord,
  ThreadSummary,
} from "./assistant-types.ts";

export const COCKPIT_TIMEOUT_MS = 10_000;
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
export const isDemoStub = (v: unknown): boolean => isRecord(v) && v.demo === true && v.ok === true;

export type JsonResult =
  | { ok: true; data: unknown }
  | { ok: false; status: EndpointStatus; httpStatus: number; note: string };

export async function fetchJsonSafe(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  signal: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
  body?: unknown,
  timeoutMs = COCKPIT_TIMEOUT_MS,
): Promise<JsonResult> {
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetcher(resolveApiUrl(path, bridge), {
      method,
      credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const isJson = res.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: "restricted", httpStatus: res.status, note: "Owner session required for this surface." };
    }
    if (res.status === 404 || !isJson) {
      return { ok: false, status: "offline", httpStatus: res.status, note: "Endpoint is unavailable on this host." };
    }
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const code = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : `status_${res.status}`;
      return { ok: false, status: "offline", httpStatus: res.status, note: `Request failed (${code}).` };
    }
    return { ok: true, data: parsed };
  } catch (err) {
    if (signal.aborted) throw err;
    return { ok: false, status: "offline", httpStatus: 0, note: "Offline or local backend unreachable." };
  }
}

function normalizeMessage(raw: unknown, idx: number): AssistantMessage | null {
  if (!isRecord(raw)) return null;
  const role = raw.role === "user" || raw.role === "assistant" ? raw.role : null;
  if (!role) return null;
  const text = typeof raw.text === "string" ? raw.text : typeof raw.content === "string" ? raw.content : "";
  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `restored-${idx}`;
  return {
    id,
    role,
    text,
    ...(typeof raw.reasoning === "string" && raw.reasoning ? { reasoning: raw.reasoning } : {}),
    ...(typeof raw.error === "string" && raw.error ? { error: raw.error } : {}),
    ...(typeof raw.createdAt === "number" ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.profileName === "string" && raw.profileName ? { profileName: raw.profileName } : {}),
  };
}

export async function listThreads(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<{ threads: ThreadSummary[]; status: EndpointStatus; note: string | null }> {
  const res = await fetchJsonSafe("GET", "/api/threads", signal, fetcher, bridge);
  if (!res.ok) return { threads: [], status: res.status, note: res.note };
  if (isDemoStub(res.data)) return { threads: [], status: "offline", note: "Local session threads only in offline demo." };
  if (!isRecord(res.data) || !Array.isArray(res.data.threads)) return { threads: [], status: "offline", note: "Threads payload unavailable." };
  const threads: ThreadSummary[] = [];
  for (const row of res.data.threads) {
    if (!isRecord(row) || typeof row.id !== "string" || !row.id.trim()) continue;
    threads.push({
      id: row.id.trim(),
      title: typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Untitled",
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0,
    });
  }
  return { threads, status: "ready", note: null };
}

export async function loadThreadById(
  id: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ThreadRecord | null> {
  const res = await fetchJsonSafe("GET", `/api/threads?id=${encodeURIComponent(id)}`, signal, fetcher, bridge);
  if (!res.ok || !isRecord(res.data) || typeof res.data.id !== "string") return null;
  const rawMsgs = Array.isArray(res.data.messages) ? res.data.messages : [];
  const messages = rawMsgs.map(normalizeMessage).filter((m): m is AssistantMessage => m !== null);
  const rawHistory = Array.isArray(res.data.history) ? res.data.history : [];
  const history = rawHistory
    .filter((m): m is { role: "user" | "assistant"; text: string } =>
      isRecord(m) && (m.role === "user" || m.role === "assistant") && typeof m.text === "string",
    )
    .map((m) => ({ role: m.role, text: m.text }));
  return {
    id: res.data.id,
    title: typeof res.data.title === "string" && res.data.title.trim() ? res.data.title.trim() : "Untitled",
    createdAt: typeof res.data.createdAt === "number" ? res.data.createdAt : 0,
    updatedAt: typeof res.data.updatedAt === "number" ? res.data.updatedAt : 0,
    messages,
    history,
  };
}

export async function saveThreadRecord(
  record: { id: string; title: string; createdAt: number; messages: AssistantMessage[]; history: Array<{ role: "user" | "assistant"; text: string }> },
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<boolean> {
  const res = await fetchJsonSafe("POST", "/api/threads", signal, fetcher, bridge, record);
  return res.ok && !isDemoStub(res.data);
}

export async function renameThreadRecord(
  id: string, title: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ThreadSummary | null> {
  const res = await fetchJsonSafe("PATCH", "/api/threads", signal, fetcher, bridge, { id, title });
  if (!res.ok || !isRecord(res.data) || !isRecord(res.data.thread)) return null;
  const t = res.data.thread;
  if (typeof t.id !== "string") return null;
  return {
    id: t.id,
    title: typeof t.title === "string" ? t.title : title,
    createdAt: typeof t.createdAt === "number" ? t.createdAt : 0,
    updatedAt: typeof t.updatedAt === "number" ? t.updatedAt : Date.now(),
  };
}

export async function deleteThreadRecord(
  id: string, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<boolean> {
  const res = await fetchJsonSafe("DELETE", `/api/threads?id=${encodeURIComponent(id)}`, signal, fetcher, bridge);
  return res.ok;
}

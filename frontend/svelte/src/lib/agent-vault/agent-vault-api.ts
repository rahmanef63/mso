import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type AgentVaultKind = "overview" | "agent" | "project" | "progress" | "inbox" | "memory";
export type AgentVaultNote = { path: string; title: string; kind: AgentVaultKind; source: string };
export type AgentVaultSnapshot = {
  id: string; capturedAt: string; notes: AgentVaultNote[]; warnings: string[]; truncated: boolean;
};
export type AgentVaultState = {
  schemaVersion: 1; project: { id: string; name: string; path: string };
  root: string; current: string | null; snapshots: AgentVaultSnapshot[]; refreshedAt: string | null;
};
export type AgentVaultView = { state: AgentVaultState; note?: { path: string; content: string } };
export type AgentVaultSyncResult = AgentVaultView & { changed: boolean };
export type AgentVaultReadOptions = { project?: string; note?: string };
export type AgentVaultViewState =
  | { kind: "loading"; project: string }
  | { kind: "ready"; vault: AgentVaultView; syncing: boolean; readingNote: boolean; notice?: string; actionError?: string }
  | { kind: "error"; message: string; forbidden?: boolean };

const VAULT_KINDS = new Set<AgentVaultKind>(["overview", "agent", "project", "progress", "inbox", "memory"]);
const SAFE_400 = new Set([
  "Select a repository id, name or path",
  "Repository not found within configured project roots",
  "This repository vault is already refreshing",
  "Vault refresh capacity reached",
  "Vault symlinks are not supported",
]);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const invalid = () => new ApiError("The MSO agent vault response is invalid.", 502);

function statusMessage(status: number, body?: unknown): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to access the agent vault.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return "Agent vault service is temporarily unavailable. Retry when ready.";
  if (status === 400 && isRecord(body) && typeof body.error === "string" && SAFE_400.has(body.error)) {
    return `${body.error}.`;
  }
  return `Agent vault request failed (${status}).`;
}

function validateNote(raw: unknown): AgentVaultNote {
  if (!isRecord(raw) || !isNonEmpty(raw.path) || !isNonEmpty(raw.title)
      || !VAULT_KINDS.has(raw.kind as AgentVaultKind) || typeof raw.source !== "string") throw invalid();
  return { path: raw.path, title: raw.title, kind: raw.kind as AgentVaultKind, source: raw.source };
}

function validateSnapshot(raw: unknown): AgentVaultSnapshot {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.capturedAt)
      || !Array.isArray(raw.notes) || !Array.isArray(raw.warnings)
      || !raw.warnings.every((w) => typeof w === "string") || typeof raw.truncated !== "boolean") throw invalid();
  return {
    id: raw.id, capturedAt: raw.capturedAt, notes: raw.notes.map(validateNote),
    warnings: raw.warnings.map((w) => w.trim()).filter(Boolean), truncated: raw.truncated,
  };
}

function validateVaultView(payload: unknown): AgentVaultView {
  if (!isRecord(payload) || !isRecord(payload.state)) throw invalid();
  const s = payload.state;
  if (s.schemaVersion !== 1 || !isRecord(s.project) || !isNonEmpty(s.project.id)
      || !isNonEmpty(s.project.name) || !isNonEmpty(s.project.path) || !isNonEmpty(s.root)
      || (s.current !== null && !isNonEmpty(s.current)) || !Array.isArray(s.snapshots)
      || (s.refreshedAt !== null && !isNonEmpty(s.refreshedAt))) throw invalid();
  let note: { path: string; content: string } | undefined;
  if (payload.note !== undefined) {
    if (!isRecord(payload.note) || !isNonEmpty(payload.note.path) || typeof payload.note.content !== "string") throw invalid();
    note = { path: payload.note.path, content: payload.note.content };
  }
  return {
    state: {
      schemaVersion: 1, project: { id: s.project.id, name: s.project.name, path: s.project.path },
      root: s.root, current: s.current, snapshots: s.snapshots.map(validateSnapshot), refreshedAt: s.refreshedAt,
    },
    ...(note ? { note } : {}),
  };
}

async function requestVaultJson(
  method: "GET" | "POST", path: string, signal: AbortSignal,
  fetcher: typeof fetch, bridge: ShellBridge, body?: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) };
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let parsed: unknown;
  try { parsed = await response.json(); } catch {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw invalid();
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, parsed), response.status);
  return parsed;
}

export async function readAgentVault(
  options: AgentVaultReadOptions, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentVaultView> {
  const params = new URLSearchParams();
  if (options.project?.trim()) params.set("project", options.project.trim());
  if (options.note?.trim()) params.set("note", options.note.trim());
  const qs = params.toString();
  return validateVaultView(await requestVaultJson("GET", qs ? `/api/v1/agent-vault?${qs}` : "/api/v1/agent-vault", signal, fetcher, bridge));
}

export async function syncAgentVault(
  project: string | undefined, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AgentVaultSyncResult> {
  const trimmed = project?.trim();
  const raw = await requestVaultJson("POST", "/api/v1/agent-vault", signal, fetcher, bridge, trimmed ? { project: trimmed } : {});
  const view = validateVaultView(raw);
  if (!isRecord(raw) || typeof raw.changed !== "boolean") throw invalid();
  return { ...view, changed: raw.changed };
}

export function createAgentVaultController(
  update: (next: AgentVaultViewState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let currentVault: AgentVaultView | null = null; let currentProject = "";

  function fail(error: unknown, fallback: string, keepReady: boolean) {
    const forbidden = error instanceof ApiError && error.status === 403;
    const authLost = error instanceof ApiError && (error.status === 401 || error.status === 403);
    const message = error instanceof ApiError ? error.message : fallback;
    if (keepReady && currentVault && !authLost) {
      update({ kind: "ready", vault: currentVault, syncing: false, readingNote: false, actionError: message });
    } else {
      currentVault = null;
      update({ kind: "error", message, ...(forbidden ? { forbidden: true } : {}) });
    }
  }

  async function runRequest<T>(
    prep: () => { keepReady: boolean },
    exec: (signal: AbortSignal) => Promise<T>,
    onSuccess: (data: T) => void,
    fallback: string,
  ) {
    if (disposed) return;
    const run = ++generation;
    active?.abort();
    const controller = (active = new AbortController());
    const { keepReady } = prep();
    try {
      const data = await exec(controller.signal);
      if (!disposed && run === generation) onSuccess(data);
    } catch (error) {
      if (!disposed && run === generation && !controller.signal.aborted) fail(error, fallback, keepReady);
    }
  }

  return {
    load(options: AgentVaultReadOptions = {}) {
      const project = options.project !== undefined ? options.project.trim() : currentProject;
      currentProject = project;
      const noteOnly = Boolean(options.note && currentVault);
      return runRequest(
        () => {
          if (noteOnly && currentVault) update({ kind: "ready", vault: currentVault, syncing: false, readingNote: true });
          else update({ kind: "loading", project });
          return { keepReady: noteOnly };
        },
        (sig) => readAgentVault({ project: project || undefined, note: options.note }, sig, fetcher, bridge),
        (vault) => { currentVault = vault; update({ kind: "ready", vault, syncing: false, readingNote: false }); },
        "Could not load agent vault. Check the backend and retry.",
      );
    },
    sync(project?: string) {
      const target = project !== undefined ? project.trim() : currentProject;
      currentProject = target;
      const hadVault = Boolean(currentVault);
      return runRequest(
        () => {
          if (currentVault) update({ kind: "ready", vault: currentVault, syncing: true, readingNote: false });
          else update({ kind: "loading", project: target });
          return { keepReady: hadVault };
        },
        (sig) => syncAgentVault(target || undefined, sig, fetcher, bridge),
        (result) => {
          currentVault = { state: result.state, ...(result.note ? { note: result.note } : {}) };
          update({
            kind: "ready", vault: currentVault, syncing: false, readingNote: false,
            notice: result.changed ? "Vault refreshed with a new snapshot." : "Vault snapshot is already up to date.",
          });
        },
        "Could not sync agent vault. Check the backend and retry.",
      );
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

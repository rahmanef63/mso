import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type ShellAppMode = "embed" | "tab";
export type ShellAppRenderer = "iframe" | "remote";
export type ShellAppDefinition = { id: string; title: string; description: string; url: string; mode: ShellAppMode };
export type ShellAppView = {
  id: string; title: string; description: string; origin: string; url?: string; blocked?: boolean;
  loginUrl?: string; renderer: ShellAppRenderer; sandbox: string; reason?: string;
  msoSession?: boolean; definition: ShellAppDefinition;
};
export type ShellAppSnapshot = { schemaVersion: 1; revision: string; configurable: boolean; apps: ShellAppView[] };
export type ShellAppMutationResult = { id: string; revision?: string };
export type ShellAppsState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: ShellAppSnapshot; busy: boolean; notice: string | null; error: string | null }
  | { kind: "error"; message: string; forbidden?: boolean };

const APP_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CTRL_RE = /[\u0000-\u001f\u007f]/;
const MUTATION_ERRORS: Record<string, string> = {
  owner_required: "Owner role is required to manage shell apps.",
  app_id_exists: "That app ID is already registered. Choose another ID.",
  app_not_found_or_ambiguous: "That app could not be found in the shell registry.",
  app_cookie_scope_conflict: "This address shares MSO's login cookie scope. Use a separate host address.",
  plain_app_url_required: "Use an HTTP or HTTPS URL without credentials, query parameters, or fragments.",
  surface_registry_changed_reload: "The app list changed. Refresh and review your changes before saving again.",
  surface_registry_capacity: "The shell app registry is full. Remove an unused app first.",
  surface_registry_managed_by_environment: "This app list is managed by deployment configuration.",
  app_owned_by_another_surface: "This entry belongs to another surface. Choose a different app ID.",
  invalid_shell_app: "Check the app ID, title, description, URL, and open mode.",
};

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

export function isValidAppId(id: string): boolean {
  return typeof id === "string" && APP_ID_RE.test(id);
}

export function isPlainHttpUrl(raw: string): boolean {
  if (typeof raw !== "string" || !raw || raw.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(raw)) return false;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  return (parsed.protocol === "http:" || parsed.protocol === "https:")
    && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
}

function statusMessage(status: number, code?: string): string {
  if (code && MUTATION_ERRORS[code]) return MUTATION_ERRORS[code];
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to manage shell apps.";
  if (status === 409) return "The app list changed or conflicted. Refresh and retry.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return "Shell app registry is temporarily unavailable. Retry when ready.";
  return `Shell app request failed (${status}).`;
}

function validateDefinition(raw: unknown): ShellAppDefinition {
  if (!isRecord(raw) || !isValidAppId(String(raw.id ?? "")) || typeof raw.title !== "string"
      || typeof raw.description !== "string" || typeof raw.url !== "string"
      || (raw.mode !== "embed" && raw.mode !== "tab")) {
    throw new ApiError("The MSO shell apps response is invalid.", 502);
  }
  return { id: raw.id as string, title: raw.title, description: raw.description, url: raw.url, mode: raw.mode };
}

function validateApp(raw: unknown): ShellAppView {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string"
      || typeof raw.description !== "string" || typeof raw.origin !== "string"
      || (raw.renderer !== "iframe" && raw.renderer !== "remote") || typeof raw.sandbox !== "string"
      || !isOptStr(raw.url) || !isOptStr(raw.reason) || !isOptStr(raw.loginUrl)
      || (raw.blocked !== undefined && typeof raw.blocked !== "boolean")
      || (raw.msoSession !== undefined && typeof raw.msoSession !== "boolean")) {
    throw new ApiError("The MSO shell apps response is invalid.", 502);
  }
  return {
    id: raw.id, title: raw.title, description: raw.description, origin: raw.origin,
    renderer: raw.renderer, sandbox: raw.sandbox, definition: validateDefinition(raw.definition),
    ...(raw.url !== undefined ? { url: raw.url } : {}),
    ...(raw.blocked !== undefined ? { blocked: raw.blocked } : {}),
    ...(raw.loginUrl !== undefined ? { loginUrl: raw.loginUrl } : {}),
    ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
    ...(raw.msoSession !== undefined ? { msoSession: raw.msoSession } : {}),
  };
}

async function requestShellApps(
  method: "GET" | "POST", signal: AbortSignal, fetcher: typeof fetch,
  bridge: ShellBridge, payload?: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (payload !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(payload); }
  const response = await fetcher(resolveApiUrl("/api/v1/shell-apps", bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers,
    ...(body !== undefined ? { body } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let data: unknown;
  try { data = await response.json(); } catch {
    throw new ApiError("The MSO shell apps response is invalid.", 502);
  }
  if (!response.ok) {
    const code = isRecord(data) && typeof data.error === "string" ? data.error : undefined;
    throw new ApiError(statusMessage(response.status, code), response.status);
  }
  return data;
}

export async function readShellApps(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ShellAppSnapshot> {
  const data = await requestShellApps("GET", signal, fetcher, bridge);
  if (!isRecord(data) || data.schemaVersion !== 1 || typeof data.revision !== "string"
      || typeof data.configurable !== "boolean" || !Array.isArray(data.apps)) {
    throw new ApiError("The MSO shell apps response is invalid.", 502);
  }
  return { schemaVersion: 1, revision: data.revision, configurable: data.configurable, apps: data.apps.map(validateApp) };
}

export async function createShellApp(
  input: ShellAppDefinition, expectedRevision: string, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ShellAppMutationResult> {
  const title = input.title.trim();
  const description = input.description.trim();
  if (!isValidAppId(input.id)) throw new ApiError("App ID must use lowercase letters, digits, or hyphens (1 to 64 chars).", 400);
  if (!title || title.length > 120 || CTRL_RE.test(title)) throw new ApiError("Enter a valid app title (1 to 120 chars).", 400);
  if (description.length > 240 || CTRL_RE.test(description)) throw new ApiError("Description must be 240 characters or fewer.", 400);
  if (!isPlainHttpUrl(input.url)) throw new ApiError(MUTATION_ERRORS.plain_app_url_required, 400);
  if (input.mode !== "embed" && input.mode !== "tab") throw new ApiError("Mode must be embed or tab.", 400);
  const app: ShellAppDefinition = { id: input.id, title, description, url: new URL(input.url).href, mode: input.mode };
  const data = await requestShellApps("POST", signal, fetcher, bridge, {
    schemaVersion: 1, action: "add", expectedRevision, confirm: true, app,
  });
  return { id: isRecord(data) && typeof data.id === "string" ? data.id : app.id, ...(isRecord(data) && typeof data.revision === "string" ? { revision: data.revision } : {}) };
}

export async function deleteShellApp(
  id: string, expectedRevision: string, signal: AbortSignal,
  fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ShellAppMutationResult> {
  if (!isValidAppId(id)) throw new ApiError("App ID is invalid.", 400);
  const data = await requestShellApps("POST", signal, fetcher, bridge, {
    schemaVersion: 1, action: "remove", expectedRevision, confirm: true, id,
  });
  return { id: isRecord(data) && typeof data.id === "string" ? data.id : id, ...(isRecord(data) && typeof data.revision === "string" ? { revision: data.revision } : {}) };
}

export function createShellAppsController(
  update: (state: ShellAppsState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let current: ShellAppSnapshot | null = null;
  const runMutation = async (work: (signal: AbortSignal, rev: string) => Promise<void>, successNotice: string) => {
    if (disposed || !current) return;
    const snap = current; const run = ++generation;
    active?.abort(); const ctrl = (active = new AbortController());
    update({ kind: "ready", snapshot: snap, busy: true, notice: null, error: null });
    try {
      await work(ctrl.signal, snap.revision);
      const next = await readShellApps(ctrl.signal, fetcher, bridge);
      if (!disposed && run === generation) {
        current = next;
        update({ kind: "ready", snapshot: next, busy: false, notice: successNotice, error: null });
      }
    } catch (error) {
      if (disposed || run !== generation || ctrl.signal.aborted) return;
      const msg = error instanceof ApiError ? error.message : "Could not update shell apps. Retry when ready.";
      if (error instanceof ApiError && error.status === 409) {
        try { current = await readShellApps(ctrl.signal, fetcher, bridge); } catch { /* keep snapshot */ }
      }
      update({ kind: "ready", snapshot: current ?? snap, busy: false, notice: null, error: msg });
    }
  };
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation; active?.abort(); const ctrl = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const snapshot = await readShellApps(ctrl.signal, fetcher, bridge);
        if (!disposed && run === generation) {
          current = snapshot;
          update({ kind: "ready", snapshot, busy: false, notice: null, error: null });
        }
      } catch (error) {
        if (!disposed && run === generation && !ctrl.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({ kind: "error", message: error instanceof ApiError ? error.message : "Could not load shell apps.", ...(forbidden ? { forbidden: true } : {}) });
        }
      }
    },
    create: (input: ShellAppDefinition) => runMutation((s, rev) => createShellApp(input, rev, s, fetcher, bridge).then(() => {}), `Registered app "${input.id}".`),
    remove: (id: string) => runMutation((s, rev) => deleteShellApp(id, rev, s, fetcher, bridge).then(() => {}), `Removed app "${id}".`),
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

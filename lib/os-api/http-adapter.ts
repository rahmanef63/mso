import { API_VERSION, type HostAccessRole, type OsApi, type SysStats } from "./types";
import type { ManagedAppView } from "@/lib/managed-apps/types";
import { uploadChunked } from "./upload";

// /api/v1 routes return `{ error: "..." }` (lib/host/api-error). Surface that
// message instead of `${status} ${statusText}` — HTTP/2 has no statusText, so a
// bare 403 would read "403 ". Defensive: body may be empty or non-JSON.
async function errorFromResponse(res: Response): Promise<Error> {
  let message = "";
  try {
    const body = (await res.json()) as { error?: unknown } | null;
    if (body && typeof body.error === "string") message = body.error;
  } catch {
    /* empty / non-JSON body — fall back to status below */
  }
  return new Error(message || `${res.status} ${res.statusText}`.trim());
}

// Two DIFFERENT shapes, which is the whole problem. The port promises a
// `running` boolean (appshell owns it and does not export the name, so it is
// derived, never re-typed); the routes send a `ManagedAppView`, whose liveness is
// a six-value `state` enum and which carries no `running` key at all. Typing the
// response as the port's type would compile and still hand callers `undefined`.
type ManagedApp = Awaited<ReturnType<OsApi["apps"]["list"]>>[number];

// `import type` only — types.ts is server-adjacent and must not ride into the
// browser bundle behind this client adapter.
type ManagedAppWire = Pick<ManagedAppView, "id" | "name" | "installed" | "state">;

// `unhealthy` and `starting` are UP, and getting that wrong is not cosmetic:
// `unhealthy` is a live unit whose /health probe failed, `starting` is one with a
// start still in flight (manager.ts:98 sets it for the whole operation). Both
// answer "yes" to "is the daemon up?", and Alfa renders this boolean as the words
// "running" / "installed, stopped" — so mapping them to false tells the operator
// their daemon is down while it is serving traffic, right after a start that worked.
const toSummary = (a: ManagedAppWire): ManagedApp => ({
  id: a.id,
  name: a.name,
  installed: a.installed,
  running: a.state === "running" || a.state === "unhealthy" || a.state === "starting",
});

// Live adapter → REST + SSE against the VPS daemon / legacy control agent at
// {baseUrl}/api/v1. Auth = the signed session cookie, sent automatically on
// same-origin requests (no Bearer token). Host actions stay allowlisted
// server-side; this is just the client.
export function HttpAdapter(cfg: { url?: string; role?: Exclude<HostAccessRole, "demo"> }): OsApi {
  const role = cfg.role ?? "viewer";
  const access = {
    role,
    canRead: true,
    canOperate: role === "operator" || role === "owner",
    canOwn: role === "owner",
  } as const;
  const root = (cfg.url || "").replace(/\/$/, "") + "/api/" + API_VERSION;

  async function req<T>(
    method: string,
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    let url = root + path;
    if (opts.query) {
      const q = new URLSearchParams(opts.query).toString();
      if (q) url += "?" + q;
    }
    const h: Record<string, string> = {};
    const init: RequestInit = { method, headers: h };
    if (opts.body !== undefined) {
      h["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(url, init);
    if (!res.ok) throw await errorFromResponse(res);
    if (res.status === 204) return null as T;
    return res.json() as Promise<T>;
  }

  function sse(path: string, query: Record<string, string>, onEvent: (d: unknown) => void) {
    const q = new URLSearchParams(query).toString();
    // Same-origin EventSource carries the session cookie automatically.
    const es = new EventSource(root + path + (q ? "?" + q : ""));
    es.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data));
      } catch {
        onEvent(e.data);
      }
    };
    return () => es.close();
  }

  return {
    mode: "live",
    access,
    auth: {
      token: (username, password) =>
        req("POST", "/auth/token", { body: { username, password } }),
      me: () => req("GET", "/auth/me"),
    },
    fs: {
      list: (path) => req("GET", "/fs/list", { query: { path } }),
      read: (path) => req("GET", "/fs/read", { query: { path } }),
      write: (path, content) => req("POST", "/fs/write", { body: { path, content } }),
      mkdir: (path) => req("POST", "/fs/mkdir", { body: { path } }),
      remove: (path) => req("DELETE", "/fs/delete", { body: { path } }),
      move: (from, to) => req("POST", "/fs/move", { body: { from, to } }),
      copy: (from, to) => req("POST", "/fs/copy", { body: { from, to } }),
      // Chunked over XHR (see lib/os-api/upload.ts): real progress + reliable past
      // proxy body limits. relPath rides as each part's filename (folders kept).
      upload: (dest, files, onProgress) =>
        uploadChunked(root + "/fs/upload", dest, files, onProgress),
      search: (query) => req("GET", "/fs/search", { query: { q: query } }),
      usage: () => req("GET", "/fs/usage"),
    },
    exec: {
      run: (cmd, cwd) => req("POST", "/exec/run", { body: { cmd, cwd } }),
    },
    sys: {
      stats: () => req("GET", "/sys/stats"),
      statsStream: (onEvent) =>
        sse("/sys/stats/stream", {}, (d) => onEvent(d as Partial<SysStats>)),
      processes: () => req("GET", "/sys/processes"),
      services: () => req("GET", "/sys/services"),
      serviceLogs: (scope, unit, limit = 120) => req("GET", "/sys/services/logs", {
        query: { scope, unit, limit: String(limit) },
      }),
      servicePower: (scope, unit, action) => req("POST", "/sys/services", { body: { scope, unit, action } }),
      packageUpdates: () => req("GET", "/sys/packages"),
    },
    apps: {
      // UNWRAP, then TRANSLATE. Both managed-app routes answer in an envelope —
      // `{apps:[…]}` and `{app:{…}}` — while the port promises the payload, and
      // `req` is generic, so TypeScript inferred the envelope AS the payload and
      // no shape error was visible anywhere. `apps.list()` handed callers an
      // object whose `.length` is undefined, which is why Alfa still answered "no
      // managed applications on this host" even after the URL was repointed to fix
      // exactly that, and `apps.power()` returned `{app}`, so the tool reported
      // "undefined: stopped" after a start that had in fact worked.
      list: async () => (await req<{ apps: ManagedAppWire[] }>("GET", "/managed-apps")).apps.map(toSummary),
      logs: (id) => req("GET", `/managed-apps/${encodeURIComponent(id)}/logs`),
      power: async (id, action) =>
        toSummary((await req<{ app: ManagedAppWire }>("POST", `/managed-apps/${encodeURIComponent(id)}`, { body: { action } })).app),
    },
    browser: {
      status: () => req("GET", "/camoufox/service"),
      power: (on) => req("POST", "/camoufox/service", { body: { action: on ? "start" : "stop" } }),
    },
  };
}

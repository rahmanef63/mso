export type PreviewDevice = "desktop" | "tablet" | "phone";
type LocationLike = { search?: string } | null | undefined;
type FsEntry = { name: string; kind: "dir" | "file"; size: number; ext?: string };
const HOME = "/home/demo", TS = "2026-11-24T00:00:00.000Z", EPOCH = 1_795_478_400_000;

export function isDemoMode(locationLike?: LocationLike, buildMode?: string): boolean {
  const mode = buildMode ?? (typeof (globalThis as Record<string, unknown>).__MSO_BUILD_MODE__ === "string"
    ? String((globalThis as Record<string, unknown>).__MSO_BUILD_MODE__) : undefined);
  if (mode === "demo") return true;
  const loc = locationLike === undefined ? ("location" in globalThis ? (globalThis.location as LocationLike) : null) : locationLike;
  const raw = typeof loc?.search === "string" ? new URLSearchParams(loc.search).get("demo") : null;
  return raw === "1" || raw?.toLowerCase() === "true";
}

const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

function normPath(raw: string | null | undefined): string {
  const input = (raw ?? "~").trim();
  const exp = !input || input === "~" ? HOME : input.startsWith("~/") ? `${HOME}/${input.slice(2)}` : input;
  const parts: string[] = [];
  for (const seg of exp.split("/")) if (seg && seg !== ".") seg === ".." ? parts.pop() : parts.push(seg);
  const res = `/${parts.join("/")}`;
  return res === "/" || res === HOME || res.startsWith(`${HOME}/`) ? res : `${HOME}${res}`;
}

async function parseBody(input: RequestInfo | URL, init?: RequestInit): Promise<Record<string, unknown>> {
  const raw = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
  try { const p = raw ? JSON.parse(raw) : null; return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : {}; } catch { return {}; }
}
function createVirtualFs() {
  const dirs = new Set<string>([HOME, `${HOME}/projects`, `${HOME}/notes`, `${HOME}/docs`]);
  const files = new Map<string, string>([
    [`${HOME}/README.md`, "# MSO Demo Workspace\n\nOffline interactive preview using in-memory synthetic data.\n"],
    [`${HOME}/notes.txt`, "Session changes stay in memory and reset on reload.\n"],
    [`${HOME}/projects/mso-status.md`, "# MSO Status\n\n- Svelte 5 static UI\n- 5 OS shells\n- 33 app routes\n"],
    [`${HOME}/notes/welcome.md`, "# Welcome\n\nEdit files, create folders, or switch OS shells offline.\n"],
    [`${HOME}/docs/shortcuts.md`, "# Shortcuts\n\n- Ctrl/Cmd + K: Command palette\n- Shift + ?: Shortcuts\n"],
  ]);
  const ensureParents = (p: string) => { const s = p.split("/").filter(Boolean); for (let i = 1; i < s.length; i++) dirs.add(`/${s.slice(0, i).join("/")}`); };
  const byteSize = (s: string) => new TextEncoder().encode(s).byteLength;
  const remove = (rawPath: string): Response => {
    const p = normPath(rawPath);
    if (files.delete(p)) return json({ ok: true });
    if (!dirs.has(p) || p === HOME) return json({ error: "not_found" }, 404);
    const pre = `${p}/`; dirs.delete(p);
    for (const d of [...dirs]) if (d.startsWith(pre)) dirs.delete(d);
    for (const f of [...files.keys()]) if (f.startsWith(pre)) files.delete(f);
    return json({ ok: true });
  };
  return {
    list(rawPath: string | null): Response {
      const dir = normPath(rawPath);
      if (!dirs.has(dir)) return json({ error: "not_found" }, 404);
      const pre = `${dir}/`, entries: FsEntry[] = [];
      for (const d of dirs) if (d.startsWith(pre) && !d.slice(pre.length).includes("/")) entries.push({ name: d.slice(pre.length), kind: "dir", size: 0 });
      for (const [f, text] of files) if (f.startsWith(pre) && !f.slice(pre.length).includes("/")) {
        const name = f.slice(pre.length), dot = name.lastIndexOf(".");
        entries.push({ name, kind: "file", size: byteSize(text), ...(dot > 0 ? { ext: name.slice(dot + 1) } : {}) });
      }
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      const parent = dir === HOME || dir === "/" ? null : dir.slice(0, dir.lastIndexOf("/")) || HOME;
      return json({ path: dir, parent, roots: [{ label: "Home", path: HOME }, { label: "Projects", path: `${HOME}/projects` }], entries });
    },
    read: (rawPath: string | null) => { const p = normPath(rawPath); return files.has(p) ? json(files.get(p)) : json({ error: "not_found" }, 404); },
    write: (rawPath: string, content: string) => { const p = normPath(rawPath); ensureParents(p); files.set(p, content); return json({ ok: true, path: p }); },
    mkdir: (rawPath: string) => { const p = normPath(rawPath); ensureParents(p); dirs.add(p); return json({ kind: "dir", path: p }); },
    remove,
    transfer(fromRaw: string, toRaw: string, move: boolean): Response {
      const from = normPath(fromRaw), to = normPath(toRaw);
      if (files.has(from)) { ensureParents(to); files.set(to, files.get(from) ?? ""); if (move) files.delete(from); return json({ ok: true }); }
      if (!dirs.has(from)) return json({ error: "not_found" }, 404);
      ensureParents(to); dirs.add(to);
      const pre = `${from}/`;
      for (const d of [...dirs]) if (d.startsWith(pre)) dirs.add(`${to}/${d.slice(pre.length)}`);
      for (const [f, text] of [...files]) if (f.startsWith(pre)) files.set(`${to}/${f.slice(pre.length)}`, text);
      if (move) remove(from);
      return json({ ok: true });
    },
    search(q: string, rootRaw: string | null): Response {
      const root = normPath(rootRaw ?? HOME), needle = q.trim().toLowerCase();
      if (!needle) return json([]);
      const hits: Array<{ name: string; path: string; kind: "dir" | "file" }> = [];
      for (const d of dirs) if (d.startsWith(`${root}/`) && d.slice(d.lastIndexOf("/") + 1).toLowerCase().includes(needle)) hits.push({ name: d.slice(d.lastIndexOf("/") + 1), path: d, kind: "dir" });
      for (const [f, text] of files) if (f.startsWith(`${root}/`)) {
        const name = f.slice(f.lastIndexOf("/") + 1);
        if (name.toLowerCase().includes(needle) || text.toLowerCase().includes(needle)) hits.push({ name, path: f, kind: "file" });
      }
      return json(hits);
    },
    usage(rawPath: string | null): Response {
      const root = normPath(rawPath ?? HOME); let bytes = 0, count = 0;
      for (const [f, text] of files) if (f === root || f.startsWith(`${root}/`)) { bytes += byteSize(text); count++; }
      return json({ path: root, bytes, files: count, dirs: dirs.size });
    },
  };
}
function buildStaticGetMap(): Record<string, unknown> {
  const wf = { id: "wf-health", name: "Host Health Check", description: "Checks host metrics.", status: "active", version: 2,
    nodes: [{ id: "n1" }, { id: "n2" }], edges: [{ id: "e1", source: "n1", target: "n2" }],
    metadata: { tags: ["ops", "demo"], folder: "ops", project: "mso" }, createdAt: TS, updatedAt: TS, revision: "1" };
  const conn = (id: string, label: string, provider: string, authMethod: string) => ({
    user: "demo", id, label, provider, source: "direct", authMethod, scope: "default", isDefault: true, missing: [],
    state: "connected", verifiedAt: EPOCH, lastCheck: { result: "ok", detail: "Synthetic demo connection" },
  });
  const orgUnit = { id: "u-core", key: "core", name: "Platform Ops", kind: "team", status: "active", sortOrder: 1, createdAt: TS, updatedAt: TS };
  const orgSeat = { id: "s-lead", unitId: "u-core", name: "Alfa", title: "Ops Assistant", role: "operator", state: "active",
    seatMode: "permanent", responsibilities: ["Monitor host"], target: { kind: "local-agent", ref: "alfa" }, sortOrder: 1, createdAt: TS, updatedAt: TS };
  const chan = { id: "ch-demo", name: "Ops Alerts", provider: "telegram", credential: { user: "demo", connection: "tg-demo" },
    enabled: true, defaultTarget: "@demo", createdAt: TS, updatedAt: TS, lastCheck: { at: TS, ok: true, detail: "Synthetic check" }, connection: { state: "connected" } };
  const vaultSnap = { id: "snap-1", capturedAt: TS, notes: [{ path: "welcome.md", title: "Welcome", kind: "overview", source: "demo" }], warnings: [], truncated: false };
  const memNodes = [{ id: "n-home", title: "Workspace Overview", kind: "note", group: "docs", degree: 1, path: `${HOME}/README.md` },
    { id: "n-status", title: "MSO Status", kind: "memory", group: "projects", degree: 1, path: `${HOME}/projects/mso-status.md` }];
  return {
    "/api/auth/me": { authenticated: true, deviceId: "demo-visitor", deviceLabel: "MSO Interactive Demo", role: "owner" },
    "/api/auth/devices": { approved: { "demo-visitor": { label: "MSO Interactive Demo", approvedAt: EPOCH, lastSeen: EPOCH, role: "owner" } }, pending: {} },
    "/api/v1/sys/stats": { cpu: { pct: 18, cores: 4 }, mem: { used: 2_450_000_000, total: 8_589_934_592 }, disk: { used: 28_400_000_000, total: 85_899_345_920 }, uptime: 412_380 },
    "/api/v1/sys/processes": [{ pid: 101, name: "mso-shell-host", status: "running", cpu: 1.2, mem: 0.4 }, { pid: 204, name: "node", status: "running", cpu: 2.8, mem: 3.1 }],
    "/api/v1/sys/packages": { manager: "apt", available: true, updates: [{ name: "openssl", current: "3.0.13", candidate: "3.0.15", architecture: "amd64" }], truncated: false, checkedAt: TS, source: "local-cache" },
    "/api/v1/sys/audit": { entries: [{ ts: TS, action: "auth.session", actor: "demo-visitor", ip: "127.0.0.1", target: "cockpit", ok: true, detail: "Offline demo session" }] },
    "/api/v1/sys/update": { supported: true, reason: null, current: "demo", currentSubject: "MSO offline demo", latest: "demo", buildSha: "demo", pendingBuild: false, ahead: 0, behind: 0, commits: [], dirty: false, running: false, remoteChecked: true, log: "", channel: "stable" },
    "/api/v1/workflows": { graphs: [wf] },
    "/api/v1/managed-apps": { apps: [{ id: "n8n", name: "n8n", description: "Workflow runtime", installed: true, installationType: "docker", state: "running", healthy: true, version: "1.82.0", dashboardAvailable: false, publicDashboardUrl: null, supportedActions: ["restart"], diagnostic: "Offline demo mode." }] },
    "/api/v1/integrations": { version: 2, user: "demo", resolution: "default", users: [{ id: "demo", label: "Demo Profile", isDefault: true, connectionCount: 2 }], connections: [conn("gh-demo", "GitHub Demo", "github", "oauth"), conn("cx-demo", "Convex Demo", "convex", "token")] },
    "/api/v1/channels": { version: 1, revision: 1, providers: [{ id: "telegram", title: "Telegram", inbound: "webhook", sendText: true, inboundEvents: true }], channels: [chan] },
    "/api/v1/infra/providers": { providers: [{ id: "dokploy", label: "Dokploy", configured: true, fields: ["endpoint"], missing: [] }, { id: "cloudflare", label: "Cloudflare", configured: true, fields: ["zone"], missing: [] }, { id: "convex", label: "Convex", configured: true, fields: ["project"], missing: [] }] },
    "/api/v1/organization": { chart: { version: 1, name: "MSO Demo Org", revision: "1", updatedAt: TS, units: [orgUnit], seats: [orgSeat] }, runtime: [{ seatId: "s-lead", targetKind: "local-agent", status: "ready", label: "Alfa (Demo)", detail: "Offline synthetic agent" }] },
    "/api/v1/memory-graph": { nodes: memNodes, edges: [{ source: "n-home", target: "n-status", kind: "wikilink", resolved: true }], truncated: false, warnings: [], root: HOME, counts: { notes: 1, memories: 1, ghosts: 0 } },
    "/api/v1/app-catalog": { status: "remote", entries: [{ kind: "managed", id: "n8n" }, { kind: "connected", manifest: { id: "demo-docs", name: "Demo Docs", description: "Offline catalog preview" } }] },
    "/api/v1/agent-vault": { state: { schemaVersion: 1, project: { id: "mso-demo", name: "MSO Demo", path: `${HOME}/projects` }, root: `${HOME}/notes`, current: "snap-1", snapshots: [vaultSnap], refreshedAt: TS }, note: { path: "welcome.md", content: "# Demo Agent Vault\nOffline synthetic snapshot." } },
    "/api/v1/agent-groups": { groups: [{ id: "grp-ops", name: "Ops Review", members: [{ id: "m1", name: "Alfa", profile: "ops" }], maxRounds: 2, enabled: true, createdAt: TS, updatedAt: TS, runs: [] }], revision: 1 },
    "/api/v1/shell-apps": { schemaVersion: 1, revision: "1", configurable: false, apps: [] },
    "/api/v1/features": { schemaVersion: 1, features: [{ id: "demo-pack", title: "Offline Demo Pack", version: "1.0.0", description: "Synthetic modular feature." }] },
    "/api/skills": { skills: [{ id: "host-health", name: "Host Health", description: "Inspect host metrics.", source: "builtin", trust: "verified" }], recipes: [{ id: "rec-1", intent: "Check host health", summary: "Reads stats and services.", successes: 3 }] },
    "/api/models": { models: [{ id: "demo-alfa", ref: "demo/alfa", provider: "demo", name: "Alfa Offline Demo", free: true, agentReady: true }] },
    "/api/v1/camoufox/service": { running: false, enabled: false, installed: false, viewerReady: false, activeState: "inactive", detail: "Offline demo mode." },
    "/api/v1/camoufox/session": { password: null, viewerOrigin: null, viewerPathPrefix: null },
    "/api/v1/desktop/containers": { containers: [] },
    "/api/v1/stock/search": { results: [] },
    "/api/changelog": { generated: true, markdown: "## Demo Build\n- Offline synthetic workspace active.\n- All 33 app routes render with in-memory data." },
    "/api/health": { ok: true, mode: "demo", status: "healthy" },
    "/api/status": { ok: true, mode: "demo", status: "healthy" },
  };
}

export function createDemoFetch(baseFetch?: typeof fetch): typeof fetch {
  const fs = createVirtualFs(), staticGet = buildStaticGetMap();
  let prefs: Record<string, unknown> = {
    tweaks: { theme: "system", reducedMotion: false, reduceGlass: false, highContrast: false, fontScale: 100, shell: { desktop: "macos", mobile: "ios" }, wallpaper: "auto" },
    quicklinks: [{ id: "ql-docs", title: "MSO Docs", url: "https://example.com/mso-docs" }], updates: { auto: false, channel: "stable" }, updatedAt: EPOCH,
  };
  let account: Record<string, unknown> = { name: "Demo Operator", icon: { type: "preset", id: "spark" } };
  const services = [{ unit: "mso.service", scope: "system", load: "loaded", active: "active", sub: "running", description: "MSO Cockpit Runtime", controllable: true }];
  return async (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl, "http://demo.local");
    if (!url.pathname.startsWith("/api/")) return baseFetch ? baseFetch(input, init) : new Response("Not Found", { status: 404 });
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(), p = url.pathname;
    if (p === "/api/prefs") {
      if (method !== "POST") return json(prefs);
      const b = await parseBody(input, init), cur = (prefs.tweaks as Record<string, unknown>) ?? {};
      prefs = { ...prefs, ...(b.tweaks && typeof b.tweaks === "object" ? { tweaks: { ...cur, ...(b.tweaks as Record<string, unknown>) } } : {}), ...(Array.isArray(b.quicklinks) ? { quicklinks: b.quicklinks } : {}), updatedAt: Date.now() };
      return json({ ok: true });
    }
    if (p === "/api/auth/account") { if (method === "POST") account = { ...account, ...(await parseBody(input, init)) }; return json(account); }
    if (p === "/api/auth/login") return json({ success: true });
    if (p === "/api/v1/fs/list") return fs.list(url.searchParams.get("path"));
    if (p === "/api/v1/fs/read") return fs.read(url.searchParams.get("path"));
    if (p === "/api/v1/fs/search") return fs.search(url.searchParams.get("q") ?? "", url.searchParams.get("root"));
    if (p === "/api/v1/fs/usage") return fs.usage(url.searchParams.get("path"));
    if (p === "/api/v1/fs/write" || p === "/api/v1/fs/mkdir" || p === "/api/v1/fs/delete" || p === "/api/v1/fs/copy" || p === "/api/v1/fs/move") {
      const b = await parseBody(input, init);
      if (p === "/api/v1/fs/write") return fs.write(String(b.path ?? ""), String(b.content ?? ""));
      if (p === "/api/v1/fs/mkdir") return fs.mkdir(String(b.path ?? ""));
      if (p === "/api/v1/fs/delete") return fs.remove(String(b.path ?? ""));
      return fs.transfer(String(b.from ?? ""), String(b.to ?? ""), p === "/api/v1/fs/move");
    }
    if (p === "/api/v1/sys/services") {
      if (method !== "POST") return json({ services, diagnostics: [], truncated: false, controlAllowlistConfigured: true, generatedAt: TS });
      const b = await parseBody(input, init), target = services.find((s) => s.unit === b.unit) ?? services[0];
      target.active = b.action === "stop" ? "inactive" : "active"; target.sub = b.action === "stop" ? "dead" : "running"; return json(target);
    }
    if (p === "/api/v1/workflows" && url.searchParams.get("runs") === "1") return json({ runs: [{ id: "run-demo-1", graphId: "wf-health", graphRevision: "1", graphName: "Host Health Check", state: "completed", startedAt: TS, updatedAt: TS, finishedAt: TS, failedNodeId: null, failedNodeName: null, trigger: { type: "manual" } }], total: 1 });
    if (p === "/api/v1/channels" && method === "POST") return json({ ok: true, detail: "Demo connectivity verified.", channel: { lastCheck: { at: TS, ok: true, detail: "Demo connectivity verified." } } });
    if (p === "/api/v1/agent-vault" && method === "POST") return json({ ...(staticGet["/api/v1/agent-vault"] as Record<string, unknown>), changed: false });
    if (p === "/api/v1/agent-groups" && method === "POST") return json({ id: "run-demo", groupId: "grp-ops", prompt: "Demo run", turns: [], state: "completed", startedAt: TS, updatedAt: TS });
    if (p === "/api/assistant") return new Response('data: {"type":"delta","text":"Offline demo mode is active."}\n\ndata: {"type":"done","stopReason":"end_turn"}\n\n', { status: 200, headers: { "content-type": "text/event-stream" } });
    if (p === "/api/v1/term/open") return json({ id: "demo-term" });
    return Object.prototype.hasOwnProperty.call(staticGet, p) ? json(staticGet[p]) : json({ ok: true, demo: true });
  };
}
let savedFetch: typeof fetch | null = null, installedFetch: typeof fetch | null = null;
export function installDemoFetch(baseFetch?: typeof fetch): typeof fetch {
  if (installedFetch && globalThis.fetch === installedFetch) return installedFetch;
  savedFetch = globalThis.fetch; installedFetch = createDemoFetch(baseFetch ?? savedFetch); globalThis.fetch = installedFetch; return installedFetch;
}
export function uninstallDemoFetch(): void {
  if (savedFetch && globalThis.fetch === installedFetch) globalThis.fetch = savedFetch; savedFetch = null; installedFetch = null;
}

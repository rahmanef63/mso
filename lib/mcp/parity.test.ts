import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

const { TOOLS } = await import("./tools");
const { HOST_TOOLS } = await import("@/frontend/slices/assistant/host-tools/catalog");

// THE GATE. Alfa and MCP are two catalogs on purpose — different transport,
// different guard (an approval card vs a scope tier), different handlers — and
// unifying them was considered and rejected: they share zero names, zero
// descriptions and zero handlers, so a shared registry would be an abstraction
// with two divergent consumers.
//
// What they must NOT do is drift by ACCIDENT, which is exactly what happened:
// MCP shipped apps_logs / apps_power / browser_status / browser_power and Alfa
// silently had less reach over the box than a remote ChatGPT connector, while
// Alfa's apps.list had been answering "no apps installed" for months. Nobody
// decided either one.
//
// So: every capability must appear in BOTH catalogs, or be listed below with a
// reason. Adding a tool to one surface alone fails this test until someone writes
// down why.

/** MCP is snake_case, Alfa is dot.case. Same capability, different convention. */
const capability = (name: string) => name.replace(/[._]/g, ".");

/** Deliberately one-sided, each with the reason. Keep this list SHORT — every
 *  entry is a place the two surfaces disagree, and a reader has to trust the
 *  reason. If a reason stops being true, delete the line and add the tool. */
const ALFA_ONLY: Record<string, string> = {
  "app.open": "openWindow is browser store state; an MCP client has no window to open",
  "memory.remember": "writes into the owner's Alfa recall, which an MCP client does not share",
  "memory.forget": "same store; an MCP client has its own memory",
};

const MCP_ONLY: Record<string, string> = {
  "screen.capture": "external MCP clients need visual proof of the rendered OS; in-shell Alfa already runs inside that browser UI",
  "projects.list": "an MCP client has no sidebar and no Files window, so it needs an explicit bounded enumeration of every project container; in-shell Alfa reads the same roots through fs.list and the Files app",
  "project.capabilities": "external harnesses need a stable generic discovery seam for project-owned MCP/functions; Alfa can inspect the same project files through its existing fs/skills tools without changing its cached tool array",
  "project.function.call": "external MCP clients need one no-shell bridge into project-declared functions; Alfa already has per-call-approved exec.run and must not receive a dynamic per-project tool catalog",
  "fs.upload.file": "external ChatGPT connectors need openai/fileParams to move conversation-generated files onto the VPS; in-shell Alfa already has direct host filesystem access",
  "workflow.start": "the external connector needs an actor-scoped task boundary; Alfa already owns an in-app conversation/run boundary",
  "workflow.status": "app-only MCP Apps bridge used by the ChatGPT progress component; Alfa already owns its in-shell run state and must not poll the external workflow store",
  "workflow.cancel": "same actor-scoped boundary; external runs need explicit recovery from an interrupted task",
  "workflow.finish": "same actor-scoped learning loop; Alfa recipes can use the session route later without weakening MCP scope semantics",
  "agent.session.current": "external MCP clients need a stable durable MSO session id they can quote from a later ChatGPT conversation; in-shell Alfa already owns its conversation identity",
  "agent.sessions.list": "external MCP clients need explicit cross-conversation session discovery; Alfa's in-app thread UI already provides its own conversation list",
  "agent.session.resume": "external MCP clients must reconstruct only the safe MSO resume packet across ChatGPT conversations; Alfa can reopen its own persisted in-app thread directly",
  "agent.session.note": "durable operational notes belong to the MCP client's isolated MSO session store; Alfa has a separate owner-scoped conversation/memory store",
  "agent.memory.read": "MCP clients use isolated USER.md/MEMORY.md-style agent memory snapshots; Alfa intentionally keeps its existing owner recall instead of sharing external-client memory",
  "agent.memory.remember": "same isolated MCP memory store; sharing it with Alfa would collapse two trust/ownership boundaries",
  "agent.memory.forget": "same isolated MCP memory store; deletion remains scoped to the external MCP client principal",
  "exec.job.start": "external MCP requests have a hard request-time budget and need a bounded resumable shell job; in-shell Alfa can keep using its interactive Terminal/approved exec.run surfaces",
  "exec.job.status": "status exists only to resume an MCP async exec job; Alfa has no corresponding external request timeout to recover from",
  "exec.job.cancel": "cancellation is paired with the MCP-only async exec lifecycle and remains actor/workflow-bound",
  "infra.providers.list": "MSO Agent and external connectors need a credential-free infrastructure capability inventory; in-shell Alfa has dedicated Dokploy/Cloudflare feature apps instead",
  "infra.provider.doctor": "provider credentials stay server-side and the terminal/external agent needs a bounded live verification tool; Alfa has no reason to receive infrastructure secrets or duplicate these clients",
  "dokploy.projects.list": "MSO Agent deploy workflows need a bounded Dokploy discovery seam; in-shell Alfa can delegate deployment through the dedicated infrastructure feature instead of duplicating this provider catalog",
  "dokploy.project.ensure": "terminal/external deployment workflows need one idempotent Dokploy mutation with scope/approval; in-shell Alfa does not own infrastructure deployment credentials",
  "cloudflare.zones.list": "terminal/external deployment workflows need bounded zone discovery while credentials stay server-side; in-shell Alfa has the Cloudflare feature app",
  "cloudflare.dns.upsert": "DNS automation is intentionally MCP/terminal-agent-only so it inherits scope, approval, audit and workflow semantics without teaching generic in-shell Alfa to mutate public DNS",
  "hostinger.dns.upsert": "external DNS mutation remains an explicitly approved deployment-agent capability; MSO sends one exact Hostinger name/type RR-set and keeps credentials server-side rather than adding a generic Alfa provider primitive",
};

describe("Alfa ↔ MCP capability parity", () => {
  const alfa = new Set(HOST_TOOLS.map((t) => capability(t.name)));
  const mcp = new Set(TOOLS.map((t) => capability(t.name)));

  it("every MCP tool has an Alfa counterpart, or a written reason", () => {
    const orphans = [...mcp].filter((c) => !alfa.has(c) && !(c in MCP_ONLY));
    expect(orphans, "add the tool to Alfa's catalog, or add it to MCP_ONLY with a reason").toEqual([]);
  });

  it("every Alfa tool has an MCP counterpart, or a written reason", () => {
    const orphans = [...alfa].filter((c) => !mcp.has(c) && !(c in ALFA_ONLY));
    expect(orphans, "add the tool to lib/mcp, or add it to ALFA_ONLY with a reason").toEqual([]);
  });

  it("the exemption lists name tools that still exist", () => {
    // A stale exemption is worse than none: it silently excuses a capability that
    // was renamed or deleted, and the gate stops covering it.
    for (const c of Object.keys(ALFA_ONLY)) expect(alfa, `ALFA_ONLY names ${c}`).toContain(c);
    for (const c of Object.keys(MCP_ONLY)) expect(mcp, `MCP_ONLY names ${c}`).toContain(c);
  });

  it("a capability that mutates on one surface mutates on the other", () => {
    // The guards differ (card vs scope) but the CLASSIFICATION must not: a tool
    // that parks an approval card in Alfa and sits in MCP's read tier would be
    // reachable with no human and no scope check at all.
    const alfaEffect = new Map(HOST_TOOLS.map((t) => [capability(t.name), t.effect]));
    for (const t of TOOLS) {
      const c = capability(t.name);
      const a = alfaEffect.get(c);
      if (!a) continue;
      const mcpMutates = t.scope !== "read";
      expect(mcpMutates, `${t.name} is ${t.scope} in MCP but ${a} in Alfa`).toBe(a === "mutate");
    }
  });
});

describe("MCP rate limits mirror the routes", () => {
  it("every mutating tool carries a per-operation limit", () => {
    // The token bucket in app/mcp/route.ts is per TOKEN and tool-blind, so without
    // this a write-scope token got 120/min on a daemon restart the UI limits to 12.
    for (const t of TOOLS) {
      if (t.scope === "read") continue;
      expect(t.limit?.max, `${t.name} has no limit — mirror its route's rateLimited()`).toBeGreaterThan(0);
    }
  });

  it("never grants more than the route it mirrors", () => {
    // Numbers lifted from the route files. The route is the authority; MCP may be
    // stricter, never laxer.
    const ROUTE_LIMITS: Record<string, number> = {
      "fs.write": 120, "fs.mkdir": 120, "fs.move": 120, "fs.copy": 60,
      "fs.delete": 60, "fs.upload": 20, "exec": 60, "managed-app": 12, "camoufox": 12,
    };
    const MCP_NATIVE_LIMITS: Record<string, number> = {
      // screen_capture has no HTTP route by design; it exists only for connected
      // MCP clients and is expensive enough to deserve a much smaller bucket.
      "screen.capture": 10,
      "workflow.memory": 30,
      // workflow_status is app-only polling. Keep its own bucket so UI refreshes
      // neither consume lifecycle capacity nor bypass the server-wide token limit.
      "workflow.status": 30,
      "exec.job.start": 12,
      "exec.job.status": 120,
      "exec.job.cancel": 30,
      // Global discovery reads: no HTTP route mirrors them, and each one walks
      // every configured container, so they get their own small buckets.
      "projects.list": 30,
      "projects.capabilities": 60,
      "projects.function": 60,
      "skills.list": 30,
      "skills.read": 60,
      "infra.dokploy": 20,
      "infra.cloudflare": 20,
      "infra.hostinger": 10,
    };
    for (const t of TOOLS) {
      if (!t.limit) continue;
      const authority = ROUTE_LIMITS[t.limit.key] ?? MCP_NATIVE_LIMITS[t.limit.key];
      expect(authority, `${t.name} limits on unknown key "${t.limit.key}"`).toBeDefined();
      expect(t.limit.max, `${t.name} exceeds its limit authority`).toBeLessThanOrEqual(authority);
    }
  });
});

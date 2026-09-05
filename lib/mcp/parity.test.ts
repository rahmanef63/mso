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
  "session.artifacts": "CLI/MCP durable-session artifact records use the authenticated client principal; Alfa browser threads have a separate identity and must not inherit another session's files",
  "session.artifact.register": "same durable-session boundary; external browser producers stage files under session context rather than accepting arbitrary paths",
  "session.artifacts.cleanup": "same session store; bounded retention is controlled by the authenticated external/CLI principal, not unrelated Alfa thread state",
  "integration.setup.open": "ChatGPT needs a write-scoped UI-only capability; native owner browser and CLI use the same secure setup service without exposing secrets to Alfa tools",
  "screen.capture": "external MCP clients need visual proof of the rendered OS; in-shell Alfa already runs inside that browser UI",
  "projects.list": "an MCP client has no sidebar and no Files window, so it needs an explicit bounded enumeration of every project container; in-shell Alfa reads the same roots through fs.list and the Files app",
  "project.capabilities": "external harnesses need a stable generic discovery seam for project-owned MCP/functions; Alfa can inspect the same project files through its existing fs/skills tools without changing its cached tool array",
  "project.function.call": "external MCP clients need one no-shell bridge into project-declared functions; Alfa already has per-call-approved exec.run and must not receive a dynamic per-project tool catalog",
  "project.mcp.tools": "external MCP clients discover one selected project MCP lazily; dynamic project tool names never enter either global catalog",
  "project.mcp.call": "external MCP clients execute one exact dynamically-discovered project MCP tool under exec scope; Alfa can use its approved exec path and must not import project MCP catalogs",
  "fs.upload.file": "external ChatGPT connectors need openai/fileParams to move conversation-generated files onto the VPS; in-shell Alfa already has direct host filesystem access",
  "workflow.start": "the external connector needs an actor-scoped task boundary; Alfa already owns an in-app conversation/run boundary",
  "workflow.status": "app-only MCP Apps bridge used by the ChatGPT progress component; Alfa already owns its in-shell run state and must not poll the external workflow store",
  "workflow.cancel": "same actor-scoped boundary; external runs need explicit recovery from an interrupted task",
  "workflow.finish": "same actor-scoped learning loop; Alfa recipes can use the session route later without weakening MCP scope semantics",
  "project.memory.search": "repo-local RASMIC orchestration memory belongs to the terminal/external workflow harness; Alfa intentionally keeps its separate owner recall and must not collapse those memory principals",
  "project.memory.upsert": "same repo-local RASMIC ledger; writes are workflow-scoped/audited for external agents rather than shared with Alfa owner recall",
  "project.script.run": "RASMIC script replay is an external/terminal orchestration primitive that revalidates bounded read-only steps and may promote candidate metadata; Alfa has no matching workflow/script lifecycle",
  "agent.session.current": "external MCP clients need a stable durable MSO session id they can quote from a later ChatGPT conversation; in-shell Alfa already owns its conversation identity",
  "agent.sessions.list": "external MCP clients need explicit cross-conversation session discovery; Alfa's in-app thread UI already provides its own conversation list",
  "agent.session.resume": "external MCP clients must reconstruct only the safe MSO resume packet across ChatGPT conversations; Alfa can reopen its own persisted in-app thread directly",
  "agent.session.rename": "durable MCP/terminal session titles are metadata in the isolated agent-session store; Alfa keeps its separate in-app thread/title lifecycle",
  "agent.session.note": "durable operational notes belong to the MCP client's isolated MSO session store; Alfa has a separate owner-scoped conversation/memory store",
  "agent.memory.read": "MCP clients use isolated USER.md/MEMORY.md-style agent memory snapshots; Alfa intentionally keeps its existing owner recall instead of sharing external-client memory",
  "agent.memory.search": "typed provenance/temporal retrieval belongs to that same isolated MCP/terminal memory ledger; exposing it as Alfa owner recall would collapse the deliberate principal boundary",
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
  "local.agents.list": "native Local Agents address durable CLI/MCP AgentSession principals; Alfa browser threads use a separate thread lifecycle and do not own a compatible durable session receiver",
  "local.agent.message.send": "same durable-session boundary; adding this to Alfa without first unifying its browser-thread identity would let one UI thread claim another principal's local receiver",
  "local.agent.inbox": "the inbox is keyed to the exact durable AgentSession principal/id; Alfa currently has a separate owner-thread store rather than that receiver identity",
  "a2a.agents.list": "A2A is an external-agent interoperability surface for MCP/terminal agents; in-shell Alfa has no remote-agent registry yet",
  "a2a.agent.discover": "public Agent Card discovery is intentionally available to the MCP/terminal agent harness and does not expose owner UI state",
  "a2a.agent.register": "remote A2A registry mutation inherits MCP write approval/audit semantics; Alfa has no matching registry surface",
  "a2a.agent.remove": "paired with the MCP/terminal A2A registry and therefore intentionally absent from Alfa",
  "a2a.message.send": "A2A peer messaging is a provider-neutral external-agent capability; Alfa remains an in-shell assistant rather than a network agent orchestrator",
  "a2a.task.get": "A2A task polling exists only for remote tasks created through the MCP/terminal A2A client",
  "a2a.task.cancel": "A2A remote task cancellation stays approval-gated in the external agent harness",
  "a2a.handoff": "explicit agent-to-agent delegation is intentionally MCP/terminal-only until Alfa receives its own scoped orchestration model",
  "agent.subagent.run": "same-session isolated subagent orchestration belongs to the terminal/MCP agent runtime; Alfa browser threads do not yet share durable AgentSession identity or its approval boundary",
  "local.agent.reply": "correlated replies belong to the durable Local Agents session mailbox; Alfa browser threads do not share that session identity or inbox",
  "local.agent.request.wait": "bounded request observation is tied to the durable Local Agents mailbox/correlation ledger; Alfa browser threads do not own that AgentSession sender identity",
  "local.agent.request": "fresh-worker execution from another durable AgentSession context belongs to the terminal/MCP orchestration runtime; Alfa browser threads neither share that isolated session store nor its exec delegation boundary",
  "tool.forge.candidates": "Tool Forge is the external/terminal cognitive-runtime promotion pipeline; Alfa has a separate in-app lifecycle and must not implicitly expose generated project capabilities",
  "tool.forge.propose": "same Forge boundary; creating an inert candidate depends on learned external workflow recipes rather than Alfa owner recall",
  "tool.forge.evaluate": "Forge evaluation may execute project-owned fixtures only inside the dedicated sandbox and therefore stays on the scoped external/terminal automation surface",
  "tool.forge.promote": "explicit Forge promotion mutates project capability metadata and remains an exec-scoped audited external/terminal action",
  "read.pipeline": "external/terminal agents can batch already-authorized read tools and compact their data server-side; Alfa already owns an in-process tool loop and does not need a second orchestration surface",
  "project.get": "external MCP/ChatGPT clients need one canonical bounded project snapshot and MCP App bootstrap; in-shell Alfa already has project/Files UI plus existing host inspection primitives",
  "project.changes.list": "external project operators need bounded Git edit history without arbitrary shell; Alfa already works inside the project shell/Files surfaces and does not need a duplicate cached history action",
  "project.diff": "external clients need portable bounded Git evidence and an inline diff summary; Alfa can inspect changes through its existing terminal/project surfaces without another global catalog entry",
  "project.knowledge.get": "always-on .mso project knowledge belongs to the external/terminal workflow context layer; Alfa keeps separate in-app conversation/memory context so the stores are not silently conflated",
  "project.knowledge.set": "same project-knowledge boundary; external writes use SHA compare-and-swap plus MCP write audit while Alfa keeps its separate context lifecycle",
  "connections.list": "external operators need one secret-free inventory spanning infrastructure, project MCP aliases and Convex readiness; Alfa already has dedicated integration/provider feature surfaces",
  "project.database.status": "the Convex project database adapter starts project code through the official project-installed MCP CLI and therefore belongs to the exec-gated external/terminal project runtime",
  "project.database.tools": "Convex schemas are discovered dynamically for the selected project and must not inflate either global catalog; Alfa can stay on its existing approved execution/project surfaces",
  "project.database.call": "dynamic Convex execution is an exec-scoped project runtime seam; Alfa must not import provider-specific dynamic tool names into its static host catalog",
  "project.database.query": "read-only Convex one-off query still launches project code, so it remains on the exec-gated external/terminal adapter rather than pretending to be an Alfa read primitive",
  "project.agent.run": "project-agent execution wraps the durable MCP/terminal AgentSession subagent runtime; Alfa browser threads have a separate lifecycle and approval identity",
  "project.agent.status": "status belongs to project-agent message ids owned by the external MCP principal/session; Alfa has no compatible project-agent task ledger",
  "vps.status": "this is an aggregate MCP Apps operator card over existing bounded host/app/browser/infra primitives; Alfa already renders equivalent in-shell operational surfaces",
  "mso.surface.apps.list": "the reviewed ChatGPT Page app catalog is MCP-App presentation metadata; Alfa already owns its in-shell app registry and must not inherit ChatGPT frame allowlists",
  "render.mso.block": "the compact Block is a ChatGPT MCP Apps presentation target for validation/action/CRUD handoff; Alfa already has native forms and approval cards",
  "render.mso.page": "the full Page is a ChatGPT MCP Apps presentation target; Alfa already is an MSO presentation target and does not render another copy of itself",
  "render.mso.surface": "app-only compatibility alias for cached pre-Page widgets; Alfa has no reason to expose the retired presentation name",
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
      // Native capabilities have independent bounded buckets (no matching HTTP route).
      "screen.capture": 10,
      "session.artifacts": 60,
      "session.artifact.register": 30,
      "session.artifact.cleanup": 6,
      "workflow.memory": 30,
      "project.memory.search": 60,
      "project.memory.write": 60,
      "project.script.run": 30,
      // workflow_status is app-only polling. Keep its own bucket so UI refreshes
      // neither consume lifecycle capacity nor bypass the server-wide token limit.
      "workflow.status": 30,
      "agent.session": 30,
      "agent.memory": 30,
      "agent.subagent": 12,
      "exec.job.start": 12,
      "exec.job.status": 120,
      "exec.job.cancel": 30,
      // Global discovery reads use independent bounded buckets.
      "projects.list": 30,
      "projects.capabilities": 60,
      "projects.function": 60,
      "projects.mcp.read": 30,
      "projects.mcp.call": 30,
      "skills.list": 30,
      "skills.read": 60,
      "integration.setup": 10,
      "infra.dokploy": 20,
      "infra.cloudflare": 20,
      "infra.hostinger": 10,
      "a2a.read": 30,
      "a2a.discovery": 20,
      "a2a.registry": 20,
      "a2a.send": 30,
      "a2a.task": 60,
      "a2a.cancel": 30,
      "local-agent.read": 120,
      "local-agent.send": 60,
      "local-agent.wait": 30,
      "local-agent.request": 12,
      "tool.forge.propose": 20,
      "tool.forge.evaluate": 10,
      "tool.forge.promote": 6,
      "read.pipeline": 30,
      "project.knowledge": 30,
    };
    for (const t of TOOLS) {
      if (!t.limit) continue;
      const authority = ROUTE_LIMITS[t.limit.key] ?? MCP_NATIVE_LIMITS[t.limit.key];
      expect(authority, `${t.name} limits on unknown key "${t.limit.key}"`).toBeDefined();
      expect(t.limit.max, `${t.name} exceeds its limit authority`).toBeLessThanOrEqual(authority);
    }
  });
});

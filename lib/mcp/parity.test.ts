import { describe, it, expect, vi } from "vitest";
import { MCP_ONLY } from "./mcp-only-reasons";
vi.mock("server-only", () => ({}));

const { TOOLS } = await import("./tools");
const { HOST_TOOLS } = await import("@/frontend/slices/assistant/host-tools/catalog");

// Every capability must be available through both MCP and Alfa, or explicitly
// justify the deliberate identity/transport boundary below. Different adapters
// are not permission to let their executable capabilities drift accidentally.

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
      "fs.write": 120, "fs.edit": 120, "fs.mkdir": 120, "fs.move": 120, "fs.copy": 60,
      "fs.delete": 60, "fs.upload": 20, "exec": 60, "managed-app": 12, "camoufox": 12,
    };
    const MCP_NATIVE_LIMITS: Record<string, number> = {
      "flow.run": 20, "flow.manage": 20, "workflow.graph": 20, "agent.session.open": 20, "project.mcp.manage": 20, "project.asset.attach": 20,
      // Native capabilities have independent bounded buckets (no matching HTTP route).
      "screen.capture": 10,
      "fs.export": 20,
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
      "jev.action": 30,
      "agent.session": 30,
      "agent.memory": 30,
      "agent.subagent": 12,
      "exec.job.start": 12,
      "exec.job.status": 120,
      "exec.job.cancel": 30,
      // Global discovery reads use independent bounded buckets.
      "projects.list": 30,
      "projects.candidates": 30,
      "projects.capabilities": 60,
      "projects.function": 60,
      "projects.mcp.read": 30,
      "projects.mcp.call": 30,
      "skills.list": 30,
      "skills.read": 60,
      "integration.setup": 10, "integration.manage":30, "integration.execute":30,
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
      "local-agent.standby": 30,
      "tool.forge.propose": 20,
      "tool.forge.evaluate": 10,
      "tool.forge.promote": 6,
      "read.pipeline": 30,
      "project.knowledge": 30,
      "organization.read": 60,
      "organization.write": 40,
      "agent.vault.read": 60,
      "agent.vault.sync": 10,
    };
    for (const t of TOOLS) {
      if (!t.limit) continue;
      const authority = ROUTE_LIMITS[t.limit.key] ?? MCP_NATIVE_LIMITS[t.limit.key];
      expect(authority, `${t.name} limits on unknown key "${t.limit.key}"`).toBeDefined();
      expect(t.limit.max, `${t.name} exceeds its limit authority`).toBeLessThanOrEqual(authority);
    }
  });
});

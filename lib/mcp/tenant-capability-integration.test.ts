import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import { fixture as persistentFixture } from "@/lib/tenancy/persistence-test-fixtures";
import { writeTenantMemory } from "@/lib/tenancy/memory-write";
import { tenantFixture } from "@/lib/tenancy/test-fixtures";

const spies = vi.hoisted(() => ({
  audit: vi.fn(), presence: vi.fn(), workflow: vi.fn(async () => null), step: vi.fn(),
  title: vi.fn(), activity: vi.fn(), event: vi.fn(), run: vi.fn(async () => ({ legacy: true })),
  rate: vi.fn(() => false),
}));
vi.mock("@/lib/host/audit-api", () => ({ audit: spies.audit }));
vi.mock("@/lib/agent/session-store", () => ({ maybeAutoTitleAgentSession: spies.title }));
vi.mock("@/lib/agent/local-agent-presence", () => ({ touchLocalAgentPresence: spies.presence }));
vi.mock("@/lib/workflow", () => ({ activeWorkflowForActor: spies.workflow, recordWorkflowStep: spies.step, replayHandlesFromResult: () => [] }));
vi.mock("@/lib/capabilities/activity", () => ({ activityTarget: () => "", newActivityId: () => "test", recordCapabilityActivity: spies.activity }));
vi.mock("@/lib/capabilities/execution-support", () => ({
  flowFields: () => ({}), recordAgentEvent: spies.event, sessionDetail: () => "", workflowFromResult: () => null,
}));
vi.mock("@/lib/capabilities/rate-limit", () => ({ capabilityRateLimited: spies.rate }));
vi.mock("@/lib/mcp/tools", () => ({
  TOOLS_BY_NAME: new Map([["agent_memory_read", {
    name: "agent_memory_read", description: "Read memory", scope: "read",
    inputSchema: { type: "object", properties: {} }, run: spies.run,
  }]]),
}));
vi.mock("@/lib/mcp/dispatch-tool-support", () => ({ structuredResult: (_name: string, value: unknown) => ({ value }) }));

import { executeCapabilityCall } from "@/lib/capabilities/execute";
import { dispatchTenantRpc } from "@/lib/mcp/tenant-dispatch";
const tool: CapabilityTool = { name: "agent_memory_read", description: "Read memory", scope: "read",
  inputSchema: { type: "object", properties: {} }, run: spies.run };
const call = (name = "agent_memory_read", args = {}) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
function noLegacyEffects() {
  for (const spy of [spies.audit, spies.presence, spies.workflow, spies.step, spies.title, spies.activity, spies.event, spies.run]) {
    expect(spy).not.toHaveBeenCalled();
  }
}
beforeEach(() => { vi.clearAllMocks(); spies.rate.mockReturnValue(false); vi.stubEnv("OS_TENANCY_MODE", "tenant-preview"); });
afterEach(() => vi.unstubAllEnvs());

describe("actual capability kernel tenant seam", () => {
  it("reads scoped memory without invoking legacy tool or telemetry", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    const result = await executeCapabilityCall({ tool, args: {}, scope: "read", actor: "untrusted-label",
      context: { tenantContext, principal: "mcp-client:shared", sessionId: "legacy-session" } });
    expect(result).toMatchObject({ kind: "success", result: { user: "tenant-a:USER.md", memory: "tenant-a:MEMORY.md" } });
    expect(spies.rate).toHaveBeenCalledWith(tool, {}, expect.stringMatching(/^tenant:/));
    noLegacyEffects();
  });
  it("reads two real persistent namespaces through the capability kernel", async () => {
    const f = await persistentFixture();
    try {
      await writeTenantMemory(f.contextA, "MEMORY.md", "disk-A", 2, 0);
      await writeTenantMemory(f.contextB, "MEMORY.md", "disk-B", 3, 0);
      const results = await Promise.all([f.contextA, f.contextB].map(tenantContext =>
        executeCapabilityCall({ tool, args: {}, scope: "read", context: { tenantContext } })));
      expect(results[0]).toMatchObject({ kind: "success", result: { memory: "disk-A" } });
      expect(results[1]).toMatchObject({ kind: "success", result: { memory: "disk-B" } });
      noLegacyEffects();
    } finally { await f.cleanup(); }
  });
  it("retains ordinary legacy execution when mode is disabled", async () => {
    vi.stubEnv("OS_TENANCY_MODE", "legacy");
    expect(await executeCapabilityCall({ tool, args: {}, scope: "read" })).toMatchObject({ kind: "success", result: { legacy: true } });
    expect(spies.run).toHaveBeenCalledOnce();
  });
  it.each(["exec_run", "fs_read", "browser_status", "apps_power", "integration_query", "project_mcp_call",
    "agent_sessions_list", "exec_job_start"])("denies unsupported tenant capability %s", async name => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    const result = await executeCapabilityCall({ tool: { ...tool, name }, args: {}, scope: "exec", context: { tenantContext } });
    expect(result.kind).toBe("error"); expect(f.reads).toHaveLength(0); noLegacyEffects();
  });
  it("missing or forged tenant context never falls back into legacy host authority", async () => {
    for (const context of [undefined, { tenantContext: { kind: "tenant-preview" as const } }]) {
      expect((await executeCapabilityCall({ tool, args: {}, scope: "exec", context })).kind).toBe("error");
    }
    noLegacyEffects();
  });
  it("scope and rate limits still apply before storage reads", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    expect((await executeCapabilityCall({ tool: { ...tool, scope: "exec" }, args: {}, scope: "read", context: { tenantContext } })).kind).toBe("error");
    spies.rate.mockReturnValue(true);
    expect((await executeCapabilityCall({ tool, args: {}, scope: "read", context: { tenantContext } })).kind).toBe("error");
    expect(f.reads).toHaveLength(0); noLegacyEffects();
  });
  it("token allowlists/constraints are not bypassed", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    for (const extra of [{ allowedTools: [] }, { toolArgumentConstraints: { agent_memory_read: { user: ["other"] } } }]) {
      expect((await executeCapabilityCall({ tool, args: {}, scope: "read", context: { tenantContext, ...extra } })).kind).toBe("error");
    }
    expect(f.reads).toHaveLength(0); noLegacyEffects();
  });
  it.each([{ tenantId: "tenant-b" }, { user: "bob" }, { workflow_id: "foreign" }, { path: "/other" }])("rejects caller selectors %j", async args => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    expect((await executeCapabilityCall({ tool, args, scope: "read", context: { tenantContext } })).kind).toBe("protocol_error");
    expect(f.reads).toHaveLength(0); noLegacyEffects();
  });
  it("adapter failure text is not exposed", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    f.overrideRead(() => { throw new Error("private backend failure"); });
    const result = await executeCapabilityCall({ tool, args: {}, scope: "read", context: { tenantContext } });
    expect(JSON.stringify(result)).not.toContain("private backend"); noLegacyEffects();
  });
});
describe("tenant-only MCP dispatcher", () => {
  it("lists only the implemented tenant tool", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    const result = await dispatchTenantRpc({ id: 1, method: "tools/list" }, "exec", "actor", { tenantContext });
    expect((result.result as { tools: { name: string }[] }).tools.map(t => t.name)).toEqual(["agent_memory_read"]);
    noLegacyEffects();
  });
  it.each(["initialize", "ping", "resources/list", "resources/templates/list", "prompts/list"])("metadata %s has no owner-state side effect", async method => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    await dispatchTenantRpc({ id: 1, method }, "read", "actor", { tenantContext });
    expect(f.reads).toHaveLength(0); noLegacyEffects();
  });
  it("modern discovery is tenant-only without protocol activity", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    const result = await dispatchTenantRpc({ id: 1, method: "server/discover",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }, "read", "actor", { tenantContext });
    expect(result.result).toMatchObject({ capabilities: { tools: {} } }); noLegacyEffects();
  });
  it("resources and unsupported tools cannot reach the legacy dispatcher", async () => {
    const f = tenantFixture(), tenantContext = await f.authority.authenticate(f.identity());
    expect(await dispatchTenantRpc({ id: 1, method: "resources/read", params: { uri: "file:///other" } }, "exec", "actor", { tenantContext })).toHaveProperty("error");
    expect(await dispatchTenantRpc(call("exec_run"), "exec", "actor", { tenantContext })).toHaveProperty("error");
    noLegacyEffects();
  });
  it("routes two concurrent subjects to distinct storage namespaces", async () => {
    const f = tenantFixture(), a = await f.authority.authenticate(f.identity()), b = await f.authority.authenticate(f.identity("bob"));
    const results = await Promise.all([a, b].map(tenantContext => dispatchTenantRpc(call(), "read", "same-client", { tenantContext })));
    expect(results[0]).toMatchObject({ result: { value: { user: "tenant-a:USER.md" } } });
    expect(results[1]).toMatchObject({ result: { value: { user: "tenant-b:USER.md" } } });
    noLegacyEffects();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ device: vi.fn() }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: mocks.device }));
import { requireWorkflowScope, workflowExecutionContext } from "./graph-authority";
import { executeCapabilityCall } from "@/lib/capabilities/execute";
const context = {principal: "web:aaaaaaaaaaaaaaaa", sessionId: "s", scope: "exec" as const};
beforeEach(() => { vi.stubEnv("OS_MCP_MAX_SCOPE", "exec"); mocks.device.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("live workflow execution authority", () => {
  it.each(["fs_write", "fs_rm", "infra_provider_create", "org_agent_configure", "project_mcp_add", "integration_manage", "future_write"])("blocks Operator %s at the execution boundary", async (name) => {
    mocks.device.mockResolvedValue({role: "operator"});
    const run = vi.fn();
    const effective = await workflowExecutionContext(context);
    const outcome = await executeCapabilityCall({tool: {name, scope: "write", run} as never, args: {}, scope: effective.scope, context: effective});
    expect(outcome).toMatchObject({kind: "error", message: expect.stringContaining("not allowed")});
    expect(run).not.toHaveBeenCalled();
  });
  it("rejects Owner-only app actions even through a permitted Operator tool", async () => {
    mocks.device.mockResolvedValue({role: "operator"});
    const effective = await workflowExecutionContext(context), run = vi.fn();
    const outcome = await executeCapabilityCall({tool: {name: "apps_power", scope: "write", run} as never, args: {action: "remove"}, scope: effective.scope, context: effective});
    expect(outcome).toMatchObject({kind: "error", message: expect.stringContaining("input is not allowed")});
    expect(run).not.toHaveBeenCalled();
  });
  it("allows only bounded Operator writes, intersects caller restrictions, and defaults new writes to Owner", async () => {
    mocks.device.mockResolvedValue({role: "operator"});
    const capabilities = {list: () => [{name: "sys_stats", scope: "read"}, {name: "fs_write", scope: "write"}, {name: "infra_provider_create", scope: "write"}, {name: "future_write", scope: "write"}]} as never;
    const effective = await workflowExecutionContext({...context, capabilities});
    expect(effective.allowedTools).toEqual(["sys_stats", "apps_power"]);
    expect(effective.toolArgumentConstraints?.apps_power.action).toEqual(["start", "stop", "restart", "backup"]);
    const restricted = await workflowExecutionContext({...context, capabilities, allowedTools: ["sys_stats", "fs_write"], toolArgumentConstraints: {apps_power: {action: ["restart", "remove"]}}});
    expect(restricted.allowedTools).toEqual(["sys_stats"]);
    expect(restricted.toolArgumentConstraints?.apps_power.action).toEqual(["restart"]);
  });
  it.each([undefined, "schedule", "webhook", "channel"] as const)("caps Operator authority for %s", async type => {
    mocks.device.mockResolvedValue({role: "operator"});
    const effective = await workflowExecutionContext(context, type ? {type, receivedAt: new Date().toISOString()} : undefined);
    expect(effective.scope).toBe("write");
    expect(() => requireWorkflowScope(effective, "exec")).toThrow();
  });
  it("rechecks demotion and revocation without cached grants", async () => {
    mocks.device.mockResolvedValueOnce({role: "owner"}).mockResolvedValueOnce({role: "operator"}).mockResolvedValueOnce(null);
    expect((await workflowExecutionContext(context)).scope).toBe("exec");
    expect((await workflowExecutionContext(context)).scope).toBe("write");
    await expect(workflowExecutionContext(context)).rejects.toThrow(/revoked/);
  });
  it("does not revive Viewer execution", async () => {
    mocks.device.mockResolvedValue({role: "viewer"});
    await expect(workflowExecutionContext(context)).rejects.toThrow(/operator/);
  });
  it("preserves caller and deployment ceilings", async () => {
    mocks.device.mockResolvedValue({role: "owner"});
    expect((await workflowExecutionContext({...context, scope: "read"})).scope).toBe("read");
    vi.stubEnv("OS_MCP_MAX_SCOPE", "write");
    expect((await workflowExecutionContext(context)).scope).toBe("write");
  });
  it("never synthesizes unattended authority from an MCP client name", async () => {
    await expect(workflowExecutionContext({...context, principal: "mcp:client"}, {type: "schedule", receivedAt: "now"})).rejects.toThrow(/not execution grants/);
  });
});

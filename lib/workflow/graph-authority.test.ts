import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ device: vi.fn() }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: mocks.device }));
import { requireWorkflowScope, workflowExecutionContext } from "./graph-authority";
const context = {principal: "web:aaaaaaaaaaaaaaaa", sessionId: "s", scope: "exec" as const};
beforeEach(() => { vi.stubEnv("OS_MCP_MAX_SCOPE", "exec"); mocks.device.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
describe("live workflow execution authority", () => {
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

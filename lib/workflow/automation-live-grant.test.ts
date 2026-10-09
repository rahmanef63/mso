import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CapabilityTool } from "@/lib/capabilities/tool";
const root = await mkdtemp(path.join(os.tmpdir(), "mso-flow-live-grant-"));
process.env.OS_DEVICE_STORE = path.join(root, "devices.json");
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_MCP_STORE = path.join(root, "mcp.json");
const devices = await import("@/lib/auth/device-store");
const { configuredSessionCookieScope } = await import("@/lib/auth/session-cookie");
const { authorizeDurableGrant, mcpAuthorizationGrant } = await import("@/lib/mcp/durable-grant");
const store = await import("@/lib/mcp/store");
const { parseFlow } = await import("./automation-schema");
const { startFlow, flowStatus } = await import("./automation-engine");
const { executeNode } = await import("./graph-runtime");
const id = "a".repeat(32);
const flow = parseFlow({ id: "fixture", description: "fixture", inputs: {}, steps: [
  { id: "first", tool: "project_mcp_call", arguments: { server: "fixture", tool: "fixture" } },
  { id: "second", tool: "project_mcp_call", arguments: { server: "fixture", tool: "fixture" } },
] });
beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.stubEnv("OS_MCP_MAX_SCOPE", "exec"); vi.stubEnv("OS_SESSION_COOKIE_DOMAIN", "");
  await devices.approveDevice(id); await devices.approveDevice("b".repeat(32));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { delete process.env.OS_DEVICE_STORE; delete process.env.OS_AGENT_SESSIONS_DIR; delete process.env.OS_MCP_STORE; await rm(root, { recursive: true, force: true }); });
it.each(["revocation", "demotion", "logout", "epoch", "expiry"])("stops browser flow actions after actual device %s", async (reason) => {
  // Pin grant time: expiry is changed explicitly below, independent of host load.
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now);
  const policy = await devices.currentSessionPolicy(configuredSessionCookieScope());
  const context = { principal: "cli:" + id, sessionId: "fixture-session", scope: "exec" as const,
    authorizationGrant: { kind: "device" as const, session: { device_id: id, issued_at: Date.now(), expires_at: Date.now() + 1000, cookie_scope: policy.scope, cookie_epoch: policy.epoch } },
    capabilities: { authorize: authorizeDurableGrant, list: () => [], invoke: vi.fn() } };
  let calls = 0;
  const tool: CapabilityTool = { name: "project_mcp_call", scope: "exec", description: "fixture", inputSchema: { type: "object", properties: {} }, run: async () => {
    calls++;
    if (reason === "revocation") await devices.revokeDevice(id);
    if (reason === "demotion") await devices.setDeviceRole(id, "viewer");
    if (reason === "logout") await devices.invalidateDeviceSessions(id);
    if (reason === "epoch") { await devices.currentSessionPolicy("domain:fixture.invalid"); await devices.currentSessionPolicy("host"); }
    if (reason === "expiry") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1001);
    return { ok: true };
  } };
  const started = await startFlow(flow, "fixture", {}, "browser-" + reason, context, () => tool);
  const result = await flowStatus(started.id, context, 5000);
  expect(result.state).toBe("failed"); expect(result.error).toMatch(/authorization/); expect(calls).toBe(1);
});
it("checks a graph node's actual token constraints and revocation before invoking", async () => {
  await store.storeToken("fixture-token", { label: "fixture", clientId: "fixture", scope: "exec", allowedTools: ["project_get"], toolArgumentConstraints: { project_get: { project: ["approved"] } } });
  const token = (await store.validateToken("fixture-token"))!;
  const context = { principal: "mcp-client:fixture", sessionId: "fixture-session", scope: "exec" as const, authorizationGrant: mcpAuthorizationGrant(token, "https://fixture.invalid/mcp"), allowedTools: token.allowedTools, toolArgumentConstraints: token.toolArgumentConstraints,
    capabilities: { authorize: authorizeDurableGrant, list: () => [], invoke: vi.fn() } };
  const run = vi.fn(async () => ({ ok: true }));
  const tool: CapabilityTool = { name: "project_get", scope: "read", description: "fixture", inputSchema: { type: "object", properties: {} }, run };
  const graph = { id: "fixture", name: "fixture", metadata: {} } as never;
  const node = (project: string) => ({ id: "fixture", name: "fixture", type: "tool", config: { tool: "project_get", arguments: { project } } }) as never;
  await executeNode(node("approved"), {} as never, graph, {}, {}, context, () => tool);
  await expect(executeNode(node("other"), {} as never, graph, {}, {}, context, () => tool)).rejects.toThrow(/authorization/);
  await store.revokeToken(token.hash);
  await expect(executeNode(node("approved"), {} as never, graph, {}, {}, context, () => tool)).rejects.toThrow(/authorization/);
  expect(run).toHaveBeenCalledTimes(1);
});

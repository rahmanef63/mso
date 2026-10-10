import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
const stream = vi.hoisted(() => vi.fn());
vi.mock("./session-store", () => ({ getAgentSession: async () => ({ id: "parent", cwd: "/fixture" }) }));
vi.mock("@/lib/mcp/tools-project-shared", () => ({ selectedProject: async () => ({ id: "fixture", name: "Fixture", path: "/fixture" }) }));
vi.mock("@/lib/mcp/workflow-workspace-guard", () => ({ requireWorkflowProjectTarget: async () => undefined }));
vi.mock("@/lib/ai/selected-model-stream", () => ({ prepareSelectedModel: async () => ({}), streamPreparedSelectedModel: stream }));
const root = await mkdtemp(path.join(os.tmpdir(), "mso-worker-grant-"));
process.env.OS_MCP_STORE = path.join(root, "mcp.json");
process.env.OS_PROJECT_AGENT_TASKS_DIR = path.join(root, "tasks");
const store = await import("@/lib/mcp/store");
const state = await import("@/lib/mcp/store-state");
const { mcpAuthorizationGrant, authorizeDurableGrant } = await import("@/lib/mcp/durable-grant");
const { runSessionSubagent } = await import("./subagent-runner");
const { runInboundA2AAgent } = await import("@/lib/a2a/inbound-agent");
const { PROJECT_RUNTIME_TOOLS } = await import("@/lib/mcp/tools-project-runtime");
const { getProjectAgentTask } = await import("./project-agent-task-store");
const invoke = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
const capabilities: CapabilityRuntime = { authorize: authorizeDurableGrant, invoke, list: () => [
  { name: "project_get", scope: "read", description: "read", inputSchema: { type: "object", properties: {} } },
  { name: "exec_run", scope: "exec", description: "exec", inputSchema: { type: "object", properties: {} } },
] };
beforeEach(() => { stream.mockReset(); invoke.mockClear(); vi.stubEnv("OS_MCP_MAX_SCOPE", "exec"); });
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { delete process.env.OS_MCP_STORE; delete process.env.OS_PROJECT_AGENT_TASKS_DIR; await rm(root, { recursive: true, force: true }); });
async function authority() {
  await store.storeToken("worker", { label: "fixture", clientId: "worker", scope: "exec", allowedTools: ["project_get"], toolArgumentConstraints: { project_get: { project: ["approved"] } } });
  const token = (await store.validateToken("worker"))!;
  return { principal: "mcp-client:worker", scope: "exec" as const, authorizationGrant: mcpAuthorizationGrant(token, "https://fixture.invalid/mcp"), allowedTools: token.allowedTools, toolArgumentConstraints: token.toolArgumentConstraints, toolProfile: "chatgpt" as const, capabilities };
}
const workers = {
  subagent: async (context: Awaited<ReturnType<typeof authority>>) => runSessionSubagent({ principal: context.principal, parentSessionId: "parent", objective: "inspect", maxScope: "exec", capabilities, authority: context }),
  local: async (context: Awaited<ReturnType<typeof authority>>) => runInboundA2AAgent({ prompt: "inspect", principal: "a2a:local:target", scope: "exec", taskId: "task", signal: new AbortController().signal, capabilities, executionContext: { authority: context } }),
  ...Object.fromEntries([true, false].map(wait => [`project wait=${wait}`, async (context: Awaited<ReturnType<typeof authority>>) => {
    const output = await PROJECT_RUNTIME_TOOLS.find(tool => tool.name === "project_agent_run")!.run(
      { project: "fixture", message: "inspect", max_scope: "exec", wait }, { ...context, sessionId: "parent" },
    ) as { message_id: string };
    let task = await getProjectAgentTask(context.principal, output.message_id);
    await vi.waitFor(async () => { task = await getProjectAgentTask(context.principal, output.message_id); expect(task?.status).not.toBe("in_progress"); });
    if (task?.status === "failed") throw new Error(task.error);
    return task;
  }])),
};
describe.each(Object.entries(workers))("%s live initiating authority", (_name, run) => {
  it("intersects the catalog and preserves the exact grant and argument restrictions", async () => {
    const context = await authority();
    stream.mockImplementationOnce(async ({ tools, emit }) => {
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(["project_get"]);
      emit("tool_use", { id: "one", name: "project_get", input: { project: "approved" } });
    }).mockImplementationOnce(async ({ emit }) => emit("delta", "done"));
    await run(context);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ principal: context.principal, authorizationGrant: context.authorizationGrant, allowedTools: ["project_get"], toolArgumentConstraints: context.toolArgumentConstraints, toolProfile: "chatgpt" }));
  });
  it.each(["revoked", "expired", "argument"])("stops a %s grant before the selected action", async (reason) => {
    const context = await authority();
    stream.mockImplementationOnce(async ({ emit }) => {
      if (reason === "revoked") await store.revokeToken((await store.validateToken("worker"))!.hash);
      if (reason === "expired") await state.mutateMcpStore(async () => { const data = await state.readMcpStore(); data.tokens[context.authorizationGrant.kind === "mcp" ? context.authorizationGrant.id : ""].expiresAt = Date.now() - 1; await state.commitMcpStore(data); });
      emit("tool_use", { id: "one", name: "project_get", input: { project: reason === "argument" ? "unapproved" : "approved" } });
    });
    await expect(run(context)).rejects.toThrow(/authorization/);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("rechecks the deployment ceiling after model selection", async () => {
    const context = await authority(); context.allowedTools = undefined;
    // Remove the credential allowlist too, so only the changed ceiling can deny exec.
    await store.storeToken("worker", { label: "unrestricted", clientId: "worker", scope: "exec" });
    context.authorizationGrant = mcpAuthorizationGrant((await store.validateToken("worker"))!, "https://fixture.invalid/mcp");
    stream.mockImplementationOnce(async ({ emit }) => { vi.stubEnv("OS_MCP_MAX_SCOPE", "read"); emit("tool_use", { id: "one", name: "exec_run", input: {} }); });
    await expect(run(context)).rejects.toThrow(/authorization/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

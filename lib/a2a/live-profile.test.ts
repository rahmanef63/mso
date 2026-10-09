import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const stream = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/selected-model-stream", () => ({ prepareSelectedModel: async () => ({}), streamPreparedSelectedModel: stream }));
const root = await mkdtemp(path.join(os.tmpdir(), "mso-a2a-live-profile-"));
process.env.OS_A2A_INBOUND_TOKEN_STORE = path.join(root, "inbound.json");
process.env.OS_A2A_TASK_STORE = path.join(root, "tasks.json");
process.env.OS_MCP_MAX_SCOPE = "exec";
const creds = await import("./credentials-inbound");
const tasks = await import("./tasks");
const { executeInboundA2ATask } = await import("./server-execution");
const invoke = vi.fn(async () => ({ content: [{ type: "text" as const, text: "ok" }] }));
const capabilities = { invoke, list: () => [
  { name: "sys_stats", description: "read", scope: "read" as const, inputSchema: { type: "object" as const, properties: {} } },
  { name: "exec_run", description: "exec", scope: "exec" as const, inputSchema: { type: "object" as const, properties: {} } },
] };
beforeEach(() => { stream.mockReset(); invoke.mockClear(); });
afterAll(async () => { delete process.env.OS_A2A_INBOUND_TOKEN_STORE; delete process.env.OS_A2A_TASK_STORE; delete process.env.OS_MCP_MAX_SCOPE; await rm(root, { recursive: true, force: true }); });
async function start(label: string) {
  const { profile } = await creds.createA2AInboundToken(label, "exec");
  const task = await tasks.createA2ATask(`a2a:${profile.id}`, "exec", { messageId: label, role: "ROLE_USER", parts: [{ text: "inspect", mediaType: "text/plain" }] });
  return { profile, task };
}
it("revoking a bearer aborts its in-flight worker before the next action and preserves other tasks", async () => {
  const { profile, task } = await start("revoked");
  const other = new AbortController(); tasks.registerA2AActiveTask("other", other, "other-profile");
  stream.mockImplementationOnce(async ({ signal, emit }) => {
    await creds.removeA2AInboundToken(profile.id);
    expect(signal.aborted).toBe(true);
    emit("tool_use", { id: "denied", name: "exec_run", input: {} });
  });
  const result = await executeInboundA2ATask(task, profile, "inspect", undefined, capabilities);
  expect(result.status.state).toBe("TASK_STATE_CANCELED"); expect(invoke).not.toHaveBeenCalled();
  expect(other.signal.aborted).toBe(false); expect(tasks.isA2ATaskActive(task.id)).toBe(false);
  tasks.releaseA2AActiveTask("other");
});
it("intersects current profile scope before invocation and on the next catalog", async () => {
  const { profile, task } = await start("lowered");
  stream.mockImplementationOnce(async ({ emit }) => {
    const data = JSON.parse(await readFile(process.env.OS_A2A_INBOUND_TOKEN_STORE!, "utf8"));
    data.tokens.find((row: { id: string }) => row.id === profile.id).scope = "read";
    await writeFile(process.env.OS_A2A_INBOUND_TOKEN_STORE!, JSON.stringify(data));
    emit("tool_use", { id: "denied", name: "exec_run", input: {} });
  }).mockImplementationOnce(async ({ tools, emit }) => {
    expect(tools.map((tool: { name: string }) => tool.name)).toEqual(["sys_stats"]);
    emit("delta", "safe");
  });
  const result = await executeInboundA2ATask(task, profile, "inspect", undefined, capabilities);
  expect(result.status.state).toBe("TASK_STATE_COMPLETED"); expect(invoke).not.toHaveBeenCalled();
});

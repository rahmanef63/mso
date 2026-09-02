import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({
    kind: "openai",
    provider: "test",
    model: "test",
  })),
  stream: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/lib/ai/selected-model-stream", () => ({
  prepareSelectedModel: mocks.prepare,
  streamPreparedSelectedModel: mocks.stream,
}));
const capabilities = {
  list: vi.fn(() => [
    { name: "sys_stats", description: "bounded read", scope: "read" as const, inputSchema: { type: "object" as const, properties: {} } },
    { name: "agent_memory_read", description: "owner memory", scope: "read" as const, inputSchema: { type: "object" as const, properties: {} } },
    { name: "exec_run", description: "host exec", scope: "exec" as const, inputSchema: { type: "object" as const, properties: {} } },
  ]),
  invoke: mocks.invoke,
};

const { runInboundA2AAgent } = await import("./inbound-agent");

describe("inbound A2A model boundary", () => {
  it("hides owner memory and higher-scope tools while isolating workflows by task session", async () => {
    let turn = 0;
    mocks.stream.mockImplementation(async ({ tools, system, emit }) => {
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
        "sys_stats",
      ]);
      expect(system).toContain("NO owner memory");
      if (turn++ === 0) {
        emit("tool_use", { id: "call-1", name: "sys_stats", input: {} });
      } else {
        emit("delta", "done");
      }
    });
    mocks.invoke.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });

    const result = await runInboundA2AAgent({
      prompt: "inspect",
      scope: "read",
      principal: "a2a:in-peer",
      taskId: "task-123",
      signal: new AbortController().signal,
      capabilities,
    });

    expect(result.text).toBe("done");
    expect(mocks.invoke).toHaveBeenCalledWith({
      name: "sys_stats",
      args: {},
      scope: "read",
      actor: "a2a:in-peer",
      principal: "a2a:in-peer",
      sessionId: "task-123",
    });
  });
});

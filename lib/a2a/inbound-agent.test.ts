import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async () => ({
    kind: "openai",
    provider: "test",
    model: "test",
  })),
  stream: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("@/lib/ai/selected-model-stream", () => ({
  prepareSelectedModel: mocks.prepare,
  streamPreparedSelectedModel: mocks.stream,
}));
vi.mock("@/lib/mcp/dispatch", () => ({ dispatch: mocks.dispatch }));
vi.mock("@/lib/mcp/tools", () => ({
  TOOLS: [
    {
      name: "sys_stats",
      description: "bounded read",
      scope: "read",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "agent_memory_read",
      description: "owner memory",
      scope: "read",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "exec_run",
      description: "host exec",
      scope: "exec",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

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
    mocks.dispatch.mockResolvedValue({
      result: { content: [{ type: "text", text: "ok" }] },
    });

    const result = await runInboundA2AAgent({
      prompt: "inspect",
      scope: "read",
      principal: "a2a:in-peer",
      taskId: "task-123",
      signal: new AbortController().signal,
    });

    expect(result.text).toBe("done");
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "tools/call",
        params: { name: "sys_stats", arguments: {} },
      }),
      "read",
      "a2a:in-peer",
      { principal: "a2a:in-peer", sessionId: "task-123" },
    );
  });
});

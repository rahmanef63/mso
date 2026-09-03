import { beforeEach, describe, expect, it, vi } from "vitest";

const stream = vi.fn();
const dispatch = vi.fn();
vi.mock("./session-store", () => ({
  getAgentSession: vi.fn(async () => ({ id: "session-a", cwd: "/srv/project", title: "parent", history: [{ role: "user", text: "TOP SECRET PARENT TRANSCRIPT" }], memorySnapshot: { user: "TOP SECRET MEMORY" } })),
}));
vi.mock("@/lib/ai/selected-model-stream", () => ({
  prepareSelectedModel: vi.fn(async () => ({ kind: "openai", provider: "x", model: "x", resolved: {}, customProvider: false })),
  streamPreparedSelectedModel: stream,
}));
vi.mock("@/lib/mcp/tools", () => ({
  TOOLS: [
    { name: "fs_read", description: "read", scope: "read", inputSchema: { type: "object", properties: {} } },
    { name: "fs_write", description: "write", scope: "write", inputSchema: { type: "object", properties: {} } },
    { name: "local_agent_message_send", description: "local", scope: "write", inputSchema: { type: "object", properties: {} } },
    { name: "agent_subagent_run", description: "nested", scope: "exec", inputSchema: { type: "object", properties: {} } },
    { name: "project_agent_run", description: "nested project wrapper", scope: "exec", inputSchema: { type: "object", properties: {} } },
  ],
}));
vi.mock("@/lib/mcp/dispatch", () => ({ dispatch }));

const { runSessionSubagent } = await import("./subagent-runner");

describe("same-session subagent runner", () => {
  beforeEach(() => { stream.mockReset(); dispatch.mockReset(); });

  it("uses isolated context, read scope by default, and returns only final result", async () => {
    let seenTools: string[] = [], firstPayload = "";
    stream.mockImplementationOnce(async (opts) => {
      seenTools = opts.tools.map((tool: { name: string }) => tool.name);
      firstPayload = JSON.stringify({ system: opts.system, messages: opts.messages });
      opts.emit("tool_use", { id: "tool-1", name: "fs_read", input: {} });
    }).mockImplementationOnce(async ({ emit }) => emit("delta", "review complete"));
    dispatch.mockResolvedValue({ result: { content: [{ type: "text", text: "file data" }] } });
    const result = await runSessionSubagent({ principal: "mcp-client:x", parentSessionId: "session-a", objective: "review auth" });
    expect(seenTools).toEqual(["fs_read"]);
    expect(result).toMatchObject({ status: "completed", text: "review complete", rounds: 2, maxScope: "read" });
    expect(result.toolCalls).toEqual([{ name: "fs_read", ok: true }]);
    expect(firstPayload).not.toContain("TOP SECRET");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ method: "tools/call" }), "read", expect.stringContaining("#subagent_"), { principal: "mcp-client:x" },
    );
  });

  it("never exposes local-agent or recursive subagent tools even with exec scope", async () => {
    let names: string[] = [];
    stream.mockImplementationOnce(async ({ tools, emit }) => { names = tools.map((tool: { name: string }) => tool.name); emit("delta", "done"); });
    const result = await runSessionSubagent({ principal: "mcp-client:x", parentSessionId: "session-a", objective: "inspect", maxScope: "exec" });
    expect(names).toContain("fs_read");
    expect(names).toContain("fs_write");
    expect(names).not.toContain("local_agent_message_send");
    expect(names).not.toContain("agent_subagent_run");
    expect(names).not.toContain("project_agent_run");
    expect(result.status).toBe("completed");
  });
});

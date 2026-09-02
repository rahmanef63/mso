import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(), discover: vi.fn(), register: vi.fn(), remove: vi.fn(), resolve: vi.fn(), send: vi.fn(), get: vi.fn(), cancel: vi.fn(), handoff: vi.fn(),
}));
vi.mock("@/lib/a2a", () => ({
  listA2AAgents: mocks.list, discoverA2AAgent: mocks.discover, registerA2AAgent: mocks.register, removeA2AAgent: mocks.remove,
  resolveA2AAgent: mocks.resolve, sendA2AMessage: mocks.send, getA2ATask: mocks.get, cancelA2ATask: mocks.cancel, handoffA2A: mocks.handoff,
}));

const { A2A_TOOLS } = await import("./tools-a2a");
const byName = new Map(A2A_TOOLS.map((tool) => [tool.name, tool]));
const peer = {
  cardUrl: "https://peer.example/.well-known/agent-card.json",
  selectedInterface: { url: "https://peer.example/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" },
  card: { name: "Peer", description: "peer agent", version: "1", supportedInterfaces: [{ url: "https://peer.example/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], capabilities: {}, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/plain"], skills: [], securityRequirements: [], securitySchemeNames: [], requiresAuthentication: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue(peer);
  mocks.handoff.mockResolvedValue({ handoff: { objectiveBytes: 8, contextBytes: 4 }, response: { task: { id: "t-1" } } });
});

describe("MCP A2A tools", () => {
  it("uses read/write/exec scopes so remote A2A actions stay approval-gated", () => {
    expect([...byName]).toHaveLength(8);
    expect(byName.get("a2a_agents_list")?.scope).toBe("read");
    expect(byName.get("a2a_agent_discover")?.scope).toBe("read");
    expect(byName.get("a2a_task_get")?.scope).toBe("read");
    for (const name of ["a2a_agent_register", "a2a_agent_remove"]) {
      expect(byName.get(name)?.scope, name).toBe("write");
      expect(byName.get(name)?.limit?.max, `${name} rate limit`).toBeGreaterThan(0);
    }
    for (const name of ["a2a_message_send", "a2a_task_cancel", "a2a_handoff"]) {
      expect(byName.get(name)?.scope, name).toBe("exec");
      expect(byName.get(name)?.limit?.max, `${name} rate limit`).toBeGreaterThan(0);
    }
  });

  it("hands off only explicit objective/context and hashes caller ids before crossing the A2A boundary", async () => {
    const tool = byName.get("a2a_handoff");
    const sessionId = "session-raw-super-secret-id";
    const workflowId = "workflow-raw-super-secret-id";
    const out = await tool!.run({ target: "peer", objective: "research", context: "facts only" }, {
      principal: "mcp-client:test", sessionId, workflowId, scope: "exec", actor: "test",
    });
    expect(mocks.resolve).toHaveBeenCalledWith("peer");
    expect(mocks.handoff).toHaveBeenCalledWith(peer, "research", "facts only", expect.objectContaining({
      sourceSessionHash: expect.stringMatching(/^[a-f0-9]{24}$/),
      sourceWorkflowHash: expect.stringMatching(/^[a-f0-9]{24}$/),
    }));
    const serialized = JSON.stringify(mocks.handoff.mock.calls[0]);
    expect(serialized).not.toContain(sessionId);
    expect(serialized).not.toContain(workflowId);
    expect(JSON.stringify(out)).toContain("t-1");
  });

  it("does not synthesize hidden context when sending a normal A2A message", async () => {
    mocks.send.mockResolvedValue({ task: { id: "t-2" } });
    await byName.get("a2a_message_send")!.run({ target: "peer", message: "explicit only" }, {
      principal: "mcp-client:test", sessionId: "hidden-session", scope: "exec", actor: "test",
    });
    expect(mocks.send).toHaveBeenCalledWith(peer, "explicit only", {
      contextId: undefined, taskId: undefined, returnImmediately: true,
    });
    expect(JSON.stringify(mocks.send.mock.calls[0])).not.toContain("hidden-session");
  });
});

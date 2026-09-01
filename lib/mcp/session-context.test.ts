import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOrCreate: vi.fn(),
  newId: vi.fn(() => "20260901_120000_11223344"),
}));
vi.mock("@/lib/agent/session-store", () => ({ findOrCreateAgentSessionForConversation: mocks.findOrCreate }));
vi.mock("@/lib/agent/session-files", () => ({ newAgentSessionId: mocks.newId }));

const { resolveMcpSession } = await import("./session-context");

const req = (transport = "transport-a") => new Request("https://mso.test/mcp", { headers: { "Mcp-Session-Id": transport } });
const call = (conversation?: string) => ({
  id: 1, method: "tools/call",
  params: { name: "sys_stats", arguments: {}, ...(conversation ? { _meta: { "openai/session": conversation } } : {}) },
});

describe("MCP conversation/session correlation", () => {
  beforeEach(() => {
    mocks.findOrCreate.mockReset().mockImplementation(async (_principal: string, hash: string) => ({ id: `s-${hash.slice(0, 10)}`, source: "mcp" }));
    mocks.newId.mockClear();
  });

  it("uses the same durable session across transport-id rotation for one ChatGPT conversation", async () => {
    const a = await resolveMcpSession(req("transport-a"), call("conversation-A"), "mcp-client:x", "MSO");
    const b = await resolveMcpSession(req("transport-b"), call("conversation-A"), "mcp-client:x", "MSO");
    expect("response" in a || "response" in b).toBe(false);
    if ("response" in a || "response" in b) return;
    expect(a.agentSessionId).toBe(b.agentSessionId);
    expect(a.responseSessionId).toBe("transport-a");
    expect(b.responseSessionId).toBe("transport-b");
    expect(a.conversationBound).toBe(true);
    expect(mocks.findOrCreate.mock.calls[0][1]).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.findOrCreate.mock.calls[0][1]).not.toContain("conversation-A");
  });

  it("separates two ChatGPT conversations using the same authenticated client", async () => {
    const a = await resolveMcpSession(req(), call("conversation-A"), "mcp-client:x", "MSO");
    const b = await resolveMcpSession(req(), call("conversation-B"), "mcp-client:x", "MSO");
    if ("response" in a || "response" in b) throw new Error("unexpected response");
    expect(a.agentSessionId).not.toBe(b.agentSessionId);
    expect(mocks.findOrCreate.mock.calls[0][1]).not.toBe(mocks.findOrCreate.mock.calls[1][1]);
  });

  it("keeps legacy transport fallback isolated instead of merging all token calls", async () => {
    const a = await resolveMcpSession(req("legacy-a"), call(), "mcp-client:x", "MSO");
    const b = await resolveMcpSession(req("legacy-b"), call(), "mcp-client:x", "MSO");
    if ("response" in a || "response" in b) throw new Error("unexpected response");
    expect(a.conversationBound).toBe(false);
    expect(a.agentSessionId).not.toBe(b.agentSessionId);
  });

  it("initialize allocates transport compatibility only and does not create durable agent state", async () => {
    const result = await resolveMcpSession(req(), { id: 1, method: "initialize" }, "mcp-client:x", "MSO");
    if ("response" in result) throw new Error("unexpected response");
    expect(result.responseSessionId).toBe("20260901_120000_11223344");
    expect(result.agentSessionId).toBeUndefined();
    expect(mocks.findOrCreate).not.toHaveBeenCalled();
  });
});

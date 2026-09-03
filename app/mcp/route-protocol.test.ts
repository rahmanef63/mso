import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateToken: vi.fn(),
  touchToken: vi.fn(async () => {}),
  getClient: vi.fn(),
  dispatch: vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: {} })),
  clampScope: vi.fn((scope: "read" | "write" | "exec") => scope),
  rateLimited: vi.fn(() => false),
  rateLimitedUntrusted: vi.fn(() => false),
  mcpRequestOriginAllowed: vi.fn(() => true),
  mcpCorsHeaders: vi.fn(() => ({ "Access-Control-Allow-Origin": "https://chatgpt.com", Vary: "Origin" })),
}));
vi.mock("@/lib/mcp/store", () => ({ validateToken: mocks.validateToken, touchToken: mocks.touchToken, getClient: mocks.getClient }));
vi.mock("@/lib/mcp/dispatch", () => ({
  dispatch: mocks.dispatch,
  isNotification: (body: unknown) => { const v = body as { id?: unknown; method?: unknown } | null; return Boolean(v && typeof v === "object" && !("id" in v) && typeof v.method === "string"); },
  rpcError: (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } }),
  UNAUTHORIZED: -32001, RATE_LIMITED: -32002,
}));
vi.mock("@/lib/mcp/scope", () => ({ mcpEnabled: () => true, clampScope: mocks.clampScope }));
vi.mock("@/lib/mcp/origin", () => ({
  publicOrigin: () => "https://mso.example.test", clientIp: () => "127.0.0.1",
  mcpRequestOriginAllowed: mocks.mcpRequestOriginAllowed, mcpCorsHeaders: mocks.mcpCorsHeaders,
}));
vi.mock("@/lib/host/limits-api", () => ({ rateLimited: mocks.rateLimited, rateLimitedUntrusted: mocks.rateLimitedUntrusted }));
vi.mock("@/lib/mcp/capability-runtime", () => ({ msoCapabilityRuntime: { list: () => [], invoke: vi.fn(async () => ({ content: [] })) } }));
vi.mock("@/lib/mcp/tools", () => ({ TOOLS: [] }));
vi.mock("@/lib/mcp/toolset", () => ({ toolsetInfo: () => ({}) }));
vi.mock("@/lib/mcp/client-profile", () => ({ detectMcpToolProfile: () => "full" }));
vi.mock("@/lib/mcp/protocol", () => ({ supportedMcpProtocol: (v: string) => ["2025-06-18", "2025-03-26", "2024-11-05"].includes(v) }));
vi.mock("@/lib/mcp/tool-contract", () => ({ visibleToolsForProfile: () => [] }));
vi.mock("@/lib/agent/session-store", () => ({ findOrCreateAgentSessionForConversation: vi.fn() }));

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://mso.example.test/mcp", { method: "POST", headers: { authorization: "Bearer live-token", "content-type": "application/json", "Mcp-Session-Id": "mso_test_session", ...headers }, body, duplex: "half" } as RequestInit & { duplex: "half" });
}

describe("/mcp protocol boundary", () => {
  beforeEach(() => {
    mocks.validateToken.mockReset(); mocks.touchToken.mockClear(); mocks.getClient.mockReset().mockResolvedValue(null); mocks.dispatch.mockClear();
    mocks.clampScope.mockClear(); mocks.rateLimited.mockClear().mockReturnValue(false); mocks.rateLimitedUntrusted.mockClear().mockReturnValue(false);
    mocks.mcpRequestOriginAllowed.mockClear().mockReturnValue(true); mocks.mcpCorsHeaders.mockClear().mockReturnValue({ "Access-Control-Allow-Origin": "https://chatgpt.com", Vary: "Origin" });
  });
  it("answers trusted browser preflight with the MCP authorization headers", async () => {
    const { OPTIONS } = await import("./route");
    const res = await OPTIONS(new Request("https://mso.example.test/mcp", { method: "OPTIONS", headers: { origin: "https://chatgpt.com" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://chatgpt.com");
    expect(mocks.mcpRequestOriginAllowed).toHaveBeenCalledOnce();
  });

  it("rejects a browser Origin that fails the Streamable HTTP boundary before auth", async () => {
    mocks.mcpRequestOriginAllowed.mockReturnValueOnce(false);
    const getReader = vi.fn(() => { throw new Error("body must not be read"); });
    const req = {
      headers: new Headers({ authorization: "Bearer live-token", origin: "https://evil.example" }),
      body: { getReader },
    } as unknown as Request;
    const { POST } = await import("./route");
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.validateToken).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a 2026-07-28 modern probe so the client can fall back to initialize", async () => {
    mocks.validateToken.mockResolvedValueOnce({ hash: "2".repeat(64), scope: "read", clientId: "client-modern-probe", label: "Modern probe" });
    const { POST } = await import("./route");
    const res = await POST(request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }), { "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": "server/discover" }));
    expect(res.status).toBe(400);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MCP-Protocol-Version before dispatch", async () => {
    mocks.validateToken.mockResolvedValueOnce({ hash: "1".repeat(64), scope: "read", clientId: "client-protocol", label: "Protocol" });
    const { POST } = await import("./route");
    const res = await POST(request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), { "MCP-Protocol-Version": "2099-01-01" }));
    expect(res.status).toBe(400);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("returns 405 for the optional Streamable HTTP SSE listener when MSO does not expose one", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("https://mso.example.test/mcp", { headers: { accept: "text/event-stream" } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});

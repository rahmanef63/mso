import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateToken: vi.fn(),
  touchToken: vi.fn(async () => {}),
  dispatch: vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: {} })),
  clampScope: vi.fn((scope: "read" | "write" | "exec") => scope),
  rateLimited: vi.fn(() => false),
  rateLimitedUntrusted: vi.fn(() => false),
  mcpRequestOriginAllowed: vi.fn(() => true),
  findOrCreateAgentSessionForConversation: vi.fn(),
}));

vi.mock("@/lib/mcp/store", () => ({
  validateToken: mocks.validateToken,
  touchToken: mocks.touchToken,
}));
vi.mock("@/lib/mcp/dispatch", () => ({
  dispatch: mocks.dispatch,
  isNotification: (body: unknown) => {
    const v = body as { id?: unknown; method?: unknown } | null;
    return Boolean(v && typeof v === "object" && !("id" in v) && typeof v.method === "string");
  },
  rpcError: (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } }),
  UNAUTHORIZED: -32001,
  RATE_LIMITED: -32002,
}));
vi.mock("@/lib/mcp/scope", () => ({
  mcpEnabled: () => true,
  clampScope: mocks.clampScope,
}));
vi.mock("@/lib/mcp/origin", () => ({
  publicOrigin: () => "https://mso.example.test",
  clientIp: () => "127.0.0.1",
  mcpRequestOriginAllowed: mocks.mcpRequestOriginAllowed,
}));
vi.mock("@/lib/host", () => ({
  rateLimited: mocks.rateLimited,
  rateLimitedUntrusted: mocks.rateLimitedUntrusted,
}));
vi.mock("@/lib/mcp/tools", () => ({ TOOLS: [] }));
vi.mock("@/lib/mcp/toolset", () => ({ toolsetInfo: () => ({}) }));
vi.mock("@/lib/agent/session-store", () => ({
  findOrCreateAgentSessionForConversation: mocks.findOrCreateAgentSessionForConversation,
}));

function request(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://mso.example.test/mcp", {
    method: "POST",
    headers: { authorization: "Bearer live-token", "content-type": "application/json", "Mcp-Session-Id": "mso_test_session", ...headers },
    body,
    // Required by Node when a ReadableStream is supplied; harmless for string bodies.
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("/mcp request boundary", () => {
  beforeEach(() => {
    mocks.validateToken.mockReset();
    mocks.touchToken.mockClear();
    mocks.dispatch.mockClear();
    mocks.clampScope.mockClear();
    mocks.rateLimited.mockClear().mockReturnValue(false);
    mocks.rateLimitedUntrusted.mockClear().mockReturnValue(false);
    mocks.mcpRequestOriginAllowed.mockClear().mockReturnValue(true);
    mocks.findOrCreateAgentSessionForConversation.mockReset().mockResolvedValue({ id: "20260901_100000_aabbccdd", source: "mcp" });
  });
  afterEach(() => vi.unstubAllEnvs());

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

  it("rejects an invalid bearer before opening the request body", async () => {
    mocks.validateToken.mockResolvedValueOnce(null);
    const getReader = vi.fn(() => { throw new Error("body must not be read"); });
    const req = {
      headers: new Headers({ authorization: "Bearer invalid" }),
      body: { getReader },
    } as unknown as Request;
    const { POST } = await import("./route");
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a declared oversized body without opening its stream", async () => {
    mocks.validateToken.mockResolvedValueOnce({ hash: "a".repeat(64), scope: "read" });
    const { MAX_MCP_BODY_BYTES, POST } = await import("./route");
    const getReader = vi.fn(() => { throw new Error("body must not be read"); });
    const req = {
      headers: new Headers({
        authorization: "Bearer live-token",
        "content-length": String(MAX_MCP_BODY_BYTES + 1),
      }),
      body: { getReader },
    } as unknown as Request;
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(getReader).not.toHaveBeenCalled();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("aborts a chunked body once the byte ceiling is crossed", async () => {
    mocks.validateToken.mockResolvedValueOnce({ hash: "b".repeat(64), scope: "read" });
    const { MAX_MCP_BODY_BYTES, POST } = await import("./route");
    const chunk = new Uint8Array(MAX_MCP_BODY_BYTES + 1);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const res = await POST(request(stream));
    expect(res.status).toBe(413);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("clamps a previously issued token to the deployment ceiling on every call", async () => {
    const token = { hash: "c".repeat(64), scope: "exec" as const, clientId: "client-clamp", label: "Clamp test" };
    mocks.validateToken.mockResolvedValueOnce(token);
    mocks.clampScope.mockReturnValueOnce("read");
    const { POST } = await import("./route");
    const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const res = await POST(request(JSON.stringify(body)));
    expect(res.status).toBe(200);
    expect(mocks.clampScope).toHaveBeenCalledWith("exec");
    expect(mocks.dispatch).toHaveBeenCalledWith(
      body,
      "read",
      `mcp:${token.hash.slice(0, 16)}`,
      undefined,
    );
  });

  it("binds tools/call to a hashed ChatGPT conversation session without forwarding the raw conversation id", async () => {
    const token = { hash: "e".repeat(64), scope: "read" as const, clientId: "client-session", label: "Session test" };
    mocks.validateToken.mockResolvedValue(token);
    const { POST } = await import("./route");
    const rawConversation = "chatgpt-conversation-raw-secret-id";
    const body = { jsonrpc: "2.0", id: 7, method: "tools/call", params: {
      name: "sys_stats", arguments: {}, _meta: { "openai/session": rawConversation },
    } };
    const res = await POST(request(JSON.stringify(body), { "Mcp-Session-Id": "transport-rotated" }));
    expect(res.status).toBe(200);
    expect(mocks.findOrCreateAgentSessionForConversation).toHaveBeenCalledTimes(1);
    const [principal, hash] = mocks.findOrCreateAgentSessionForConversation.mock.calls[0];
    expect(principal).toBe(`mcp-client:${token.clientId}`);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(rawConversation);
    expect(mocks.dispatch).toHaveBeenCalledWith(body, "read", `mcp:${token.hash.slice(0, 16)}`, {
      principal: `mcp-client:${token.clientId}`, sessionId: "20260901_100000_aabbccdd",
    });
  });

  it("applies the 50,000-call daily token limit", async () => {
    const token = { hash: "d".repeat(64), scope: "read" as const, clientId: "client-daily", label: "Daily test" };
    mocks.validateToken.mockResolvedValueOnce(token);
    const { POST } = await import("./route");
    await POST(request(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })));
    expect(mocks.rateLimited).toHaveBeenNthCalledWith(2, `mcp:day:${token.hash}`, 50_000, 86_400_000);
  });

  it("does not acknowledge an unauthenticated notification", async () => {
    mocks.validateToken.mockResolvedValueOnce(null);
    const { POST } = await import("./route");
    const res = await POST(request(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })));
    expect(res.status).toBe(401);
  });
});

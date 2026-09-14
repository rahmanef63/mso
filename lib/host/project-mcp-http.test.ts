import { beforeEach, expect, it, vi } from "vitest";
type Mode = "modern" | "method-not-found" | "http-404" | "protocol-unsupported" | "invalid-params";
const state = vi.hoisted(() => ({ calls: [] as Array<{ method: string; headers: Headers; params: Record<string, unknown> }>, serial: 0, mode: "modern" as Mode }));
function rpcResult(id: unknown, result: unknown, extra: HeadersInit = {}, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { status, headers: { "content-type": "application/json", ...extra } });
}
function rpcError(id: unknown, code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), { status, headers: { "content-type": "application/json" } });
}
vi.mock("./ssrf", () => ({ safeProviderFetch: vi.fn(async (_url, init) => {
  const body = JSON.parse(init.body), headers = new Headers(init.headers); state.calls.push({ method: body.method, headers, params: body.params ?? {} });
  if (body.method === "server/discover") {
    if (state.mode === "method-not-found") return rpcError(body.id, -32601, "Method not found");
    if (state.mode === "http-404") return rpcError(body.id, -32601, "Method not found", 404);
    if (state.mode === "protocol-unsupported") return rpcError(body.id, -32022, "unsupported MCP protocol version", 400);
    if (state.mode === "invalid-params") return rpcError(body.id, -32602, "invalid params", 400);
    return rpcResult(body.id, { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  }
  if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} } }, { "mcp-session-id": "legacy-session" });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  const result = body.method === "tools/list" ? { tools: [
    { name: "echo", inputSchema: { type: "object", properties: { context: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } } } } },
    { name: "bad", inputSchema: { type: "object", properties: { amount: { type: "number", "x-mcp-header": "Amount" } } } },
  ] } : { content: [{ type: "text", text: "done" }], isError: false };
  return rpcResult(body.id, state.mode === "modern" ? { resultType: "complete", ...result } : result);
}) }));
import { withHttp } from "./project-mcp-http";
import { mcpHeaderBindings, mcpArgumentHeaders } from "./project-mcp-headers";
function server() { return { name: "fixture", transport: "http" as const, url: "https://example.test/mcp/" + state.serial, headers: {}, oauthConfigured: false }; }
beforeEach(() => { state.calls = []; state.serial++; state.mode = "modern"; });
it("negotiates modern HTTP once, filters invalid header schemas and mirrors nested Unicode arguments", async () => {
  const list = await withHttp(server(), rpc => rpc("tools/list", {}));
  expect((list.result as { tools: unknown[] }).tools).toHaveLength(1);
  await withHttp(server(), rpc => rpc("tools/call", { name: "echo", arguments: { context: { region: " 東京 " } } }));
  expect(state.calls.map(c => c.method)).toEqual(["server/discover", "tools/list", "tools/call"]);
  const call = state.calls.at(-1)!;
  expect(call.headers.get("Mcp-Param-Region")).toBe("=?base64?" + Buffer.from(" 東京 ").toString("base64") + "?=");
  expect(call.headers.get("Mcp-Session-Id")).toBeNull();
  expect(call.params._meta).toMatchObject({ "io.modelcontextprotocol/clientCapabilities": {} });
});
it("falls back to initialize when discover returns JSON-RPC -32601 on HTTP 200", async () => {
  state.mode = "method-not-found";
  const list = await withHttp(server(), rpc => rpc("tools/list", {}));
  expect((list.result as { tools: unknown[] }).tools).toHaveLength(2);
  expect(state.calls.map(c => c.method)).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list"]);
  expect(state.calls[0].headers.get("MCP-Protocol-Version")).toBe("2026-07-28");
  expect(state.calls.find(c => c.method === "initialize")?.params._meta).toBeUndefined();
  expect(state.calls.at(-1)!.headers.get("Mcp-Session-Id")).toBe("legacy-session");
  expect(JSON.stringify(list)).not.toMatch(/token|secret|authorization/i);
});
it("falls back when modern discover is HTTP 404 method-not-found or protocol-version refusal", async () => {
  for (const mode of ["http-404", "protocol-unsupported"] as const) {
    state.calls = []; state.serial++; state.mode = mode;
    const list = await withHttp(server(), rpc => rpc("tools/list", {}));
    expect((list.result as { tools: { name: string }[] }).tools.map(t => t.name)).toEqual(["echo", "bad"]);
    expect(state.calls.map(c => c.method)).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list"]);
  }
});
it("does not treat malformed modern discover params as an unsupported-method fallback", async () => {
  state.mode = "invalid-params";
  await expect(withHttp(server(), rpc => rpc("tools/list", {}))).rejects.toThrow(/-32602/);
  expect(state.calls.map(c => c.method)).toEqual(["server/discover"]);
});
it("rejects duplicate/composition annotations and unsafe integer values", () => {
  expect(() => mcpHeaderBindings({ properties: { a: { type: "string", "x-mcp-header": "X" }, b: { type: "string", "x-mcp-header": "x" } } })).toThrow();
  expect(() => mcpHeaderBindings({ oneOf: [{ properties: { a: { type: "string", "x-mcp-header": "X" } } }] })).toThrow();
  const binding = mcpHeaderBindings({ properties: { count: { type: "integer", "x-mcp-header": "Count" } } });
  expect(() => mcpArgumentHeaders(binding, { count: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  expect(mcpArgumentHeaders(binding, {})).toEqual({});
});

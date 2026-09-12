import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ calls: [] as Array<{ method: string; headers: Headers; params: Record<string, unknown> }>, serial: 0 }));
vi.mock("./ssrf", () => ({ safeProviderFetch: vi.fn(async (_url, init) => {
  const body = JSON.parse(init.body), headers = new Headers(init.headers); state.calls.push({ method: body.method, headers, params: body.params });
  const result = body.method === "server/discover" ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } } : body.method === "tools/list" ? { tools: [
    { name: "echo", inputSchema: { type: "object", properties: { context: { type: "object", properties: { region: { type: "string", "x-mcp-header": "Region" } } } } } },
    { name: "bad", inputSchema: { type: "object", properties: { amount: { type: "number", "x-mcp-header": "Amount" } } } },
  ] } : { content: [{ type: "text", text: "done" }], isError: false };
  return Response.json({ jsonrpc: "2.0", id: body.id, result: { resultType: "complete", ...result } });
}) }));
import { withHttp } from "./project-mcp-http";
import { mcpHeaderBindings, mcpArgumentHeaders } from "./project-mcp-headers";
beforeEach(() => { state.calls = []; state.serial++; });
it("negotiates modern HTTP once, filters invalid header schemas and mirrors nested Unicode arguments", async () => {
  const server = { name: "modern", transport: "http" as const, url: "https://example.test/mcp/" + state.serial, headers: {}, oauthConfigured: false };
  const list = await withHttp(server, rpc => rpc("tools/list", {}));
  expect((list.result as { tools: unknown[] }).tools).toHaveLength(1);
  await withHttp(server, rpc => rpc("tools/call", { name: "echo", arguments: { context: { region: " 東京 " } } }));
  expect(state.calls.map(c => c.method)).toEqual(["server/discover", "tools/list", "tools/call"]);
  const call = state.calls.at(-1)!;
  expect(call.headers.get("Mcp-Param-Region")).toBe("=?base64?" + Buffer.from(" 東京 ").toString("base64") + "?=");
  expect(call.headers.get("Mcp-Session-Id")).toBeNull();
  expect(call.params._meta).toMatchObject({ "io.modelcontextprotocol/clientCapabilities": {} });
});
it("rejects duplicate/composition annotations and unsafe integer values", () => {
  expect(() => mcpHeaderBindings({ properties: { a: { type: "string", "x-mcp-header": "X" }, b: { type: "string", "x-mcp-header": "x" } } })).toThrow();
  expect(() => mcpHeaderBindings({ oneOf: [{ properties: { a: { type: "string", "x-mcp-header": "X" } } }] })).toThrow();
  const binding = mcpHeaderBindings({ properties: { count: { type: "integer", "x-mcp-header": "Count" } } });
  expect(() => mcpArgumentHeaders(binding, { count: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
  expect(mcpArgumentHeaders(binding, {})).toEqual({});
});

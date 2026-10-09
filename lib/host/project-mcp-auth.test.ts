import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ values: { endpoint: "https://app.example/mcp", accessToken: "private-downstream-token", allowedTools: "read_project" } as Record<string, string>, calls: [] as Record<string, unknown>[], paging: "", discoverStatus: 400 }));
vi.mock("@/lib/infra/connection-service", () => ({ directConnectionValues: vi.fn(async () => state.values), resolveIntegration: async () => ({ user: "owner", id: "assistant" }) }));
vi.mock("./ssrf", () => ({ safeProviderFetch: vi.fn(async (_url, init) => {
  const payload = JSON.parse(init.body);
  state.calls.push({ ...payload, auth: new Headers(init.headers).get("authorization") });
  if (payload.method === "server/discover") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "Method not found" } }), { status: state.discoverStatus });
  if (payload.method === "tools/list" && state.paging) {
    const second = Boolean(payload.params?.cursor);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {
      tools: [{ name: second ? "read_next" : "read_project", inputSchema: { type: "object" } }],
      ...(!second || state.paging === "repeat" ? { nextCursor: "page-two" } : {})
    } }), { headers: { "content-type": "application/json" } });
  }
  if (state.values.accessToken === "revoked-token-value") return new Response("private error", { status: 401 });
  const result = payload.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} } }
    : payload.method === "tools/list" ? { tools: [{ name: "read_project", description: "private-downstream-token", inputSchema: { type: "object", properties: { "private-downstream-token": { description: "private-downstream-token" } } }, _meta: { "private-downstream-token": "private-downstream-token" } }, { name: "delete_project", inputSchema: { type: "object" } }] }
    : { content: [{ type: "text", text: "echo private-downstream-token" }], structuredContent: { "private-downstream-token": "echoed key" }, _meta: { nested: ["private-downstream-token"] } };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), { headers: { "content-type": "application/json" } });
}) }));
import { callMcpServerTool, listMcpServerTools } from "./project-mcp-client";
import { normalizeMcpEndpoint, parseMcpToolAllowlist } from "@/lib/infra/mcp-policy";
import type { ProjectMcpServer } from "./project-mcp-config";
import { callNamedMcpConnectionTool, listNamedMcpConnectionTools } from "@/lib/infra/mcp-connection";
const server: ProjectMcpServer = { name: "app", transport: "http", url: "https://app.example/mcp", headers: {}, oauthConfigured: false, integration: { user: "owner", connection: "assistant" } };

beforeEach(() => { state.calls = []; state.paging = ""; state.discoverStatus = 400; state.values = { endpoint: "https://app.example/mcp", accessToken: "private-downstream-token", allowedTools: "read_project" }; });

describe("private modular MCP connection", () => {
  it("uses the same private binding and recursive redaction for named integrations", async () => {
    const tools = await listNamedMcpConnectionTools({ user: "owner", connection: "assistant" });
    const result = await callNamedMcpConnectionTool({ user: "owner", connection: "assistant" }, "read_project", {});
    expect(JSON.stringify({ tools, result })).not.toContain("private-downstream-token");
    expect(JSON.stringify({ tools, result })).toContain("[redacted]");
    expect(state.calls.filter((row) => row.method === "tools/call")).toHaveLength(1);
    expect(state.calls.every((row) => row.auth === "Bearer private-downstream-token")).toBe(true);
  });
  it("redacts reflected RPC errors from the named integration path", async () => {
    const { safeProviderFetch } = await import("./ssrf");
    vi.mocked(safeProviderFetch).mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      return Response.json({ jsonrpc: "2.0", id: payload.id, error: { code: -1, message: "private-downstream-token" } });
    });
    const request = callNamedMcpConnectionTool({ user: "owner", connection: "assistant" }, "read_project", {});
    await expect(request).rejects.toThrow(/redacted/);
    await expect(request).rejects.not.toThrow(/private-downstream-token/);
  });
  it("falls back from HTTP 200 method-not-found when the private token is verified", async () => {
    state.discoverStatus = 200;
    const url = "https://app.example/mcp/http200";
    state.values.endpoint = url;
    const tools = await listMcpServerTools({ ...server, url } as ProjectMcpServer);
    expect(tools.map((tool) => tool.name)).toEqual(["read_project"]);
    expect(state.calls[0]).toMatchObject({ method: "server/discover", auth: "Bearer private-downstream-token" });
    expect(state.calls.some((call) => call.method === "initialize")).toBe(true);
    const result = await callMcpServerTool({ ...server, url } as ProjectMcpServer, "read_project", {});
    expect(JSON.stringify({ tools, result })).not.toContain("private-downstream-token");
    expect(JSON.stringify(result)).toContain("[redacted]");
  });
  it("discovers only granted tools and authenticates without returning the credential", async () => {
    expect((await listMcpServerTools(server)).map((tool) => tool.name)).toEqual(["read_project"]);
    expect(state.calls.every((call) => call.auth === "Bearer private-downstream-token")).toBe(true);
    const result = await callMcpServerTool(server, "read_project", {});
    expect(JSON.stringify(result)).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain("private-downstream-token");
  });
  it("refuses disallowed writes at call time before they reach the server", async () => {
    await expect(callMcpServerTool(server, "delete_project", {})).rejects.toThrow(/not allowed/);
    expect(state.calls.some((call) => call.method === "tools/call")).toBe(false);
  });
  it("refuses retargeting a connection to another endpoint without sending its token", async () => {
    await expect(listMcpServerTools({ ...server, url: "https://other.example/mcp" } as ProjectMcpServer)).rejects.toThrow(/does not match/);
    expect(state.calls).toHaveLength(0);
  });
  it("refuses missing credentials without an ambient-token fallback", async () => {
    state.values = {};
    await expect(listMcpServerTools(server)).rejects.toThrow(/private setup/);
    expect(state.calls).toHaveLength(0);
  });
  it("rechecks connection changes before executing the task", async () => {
    const { directConnectionValues } = await import("@/lib/infra/connection-service");
    vi.mocked(directConnectionValues).mockResolvedValueOnce({ ...state.values }).mockResolvedValueOnce({ ...state.values, accessToken: "different-principal-token" });
    await expect(callMcpServerTool(server, "read_project", {})).rejects.toThrow(/connection changed/);
    expect(state.calls.some((call) => call.method === "tools/call")).toBe(false);
  });
  it("follows catalog pages without silently hiding later tools", async () => {
    state.paging = "two"; state.values.allowedTools = "read_project,read_next";
    expect((await listMcpServerTools(server)).map((tool) => tool.name)).toEqual(["read_project", "read_next"]);
  });
  it("refuses repeated cursors instead of presenting partial discovery as complete", async () => {
    state.paging = "repeat";
    await expect(listMcpServerTools(server)).rejects.toThrow(/continuation cursor/);
  });
  it("reports revoked authentication without reflecting the server response body", async () => {
    state.values.accessToken = "revoked-token-value";
    await expect(listMcpServerTools(server)).rejects.toThrow(/HTTP 401/);
    await expect(listMcpServerTools(server)).rejects.not.toThrow(/private error/);
  });
  it("rejects credential URLs and wildcard tool grants", () => {
    for (const url of ["http://app.example/mcp", "https://user:pass@app.example/mcp", "https://app.example/mcp?key=secret"]) expect(() => normalizeMcpEndpoint(url)).toThrow();
    expect(() => parseMcpToolAllowlist("*")).toThrow();
    expect(parseMcpToolAllowlist("read_project, read_project")).toEqual(["read_project"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ values: { endpoint: "https://app.example/mcp", accessToken: "private-downstream-token", allowedTools: "read_project" } as Record<string, string>, calls: [] as Record<string, unknown>[], paging: "" }));
vi.mock("@/lib/infra/connection-service", () => ({ directConnectionValues: vi.fn(async () => state.values) }));
vi.mock("./ssrf", () => ({ safeProviderFetch: vi.fn(async (_url, init) => {
  const payload = JSON.parse(init.body);
  state.calls.push({ ...payload, auth: new Headers(init.headers).get("authorization") });
  if (payload.method === "server/discover") return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "legacy" } }), { status: 400 });
  if (payload.method === "tools/list" && state.paging) {
    const second = Boolean(payload.params?.cursor);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: {
      tools: [{ name: second ? "read_next" : "read_project", inputSchema: { type: "object" } }],
      ...(!second || state.paging === "repeat" ? { nextCursor: "page-two" } : {})
    } }), { headers: { "content-type": "application/json" } });
  }
  if (state.values.accessToken === "revoked-token-value") return new Response("private error", { status: 401 });
  const result = payload.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} } }
    : payload.method === "tools/list" ? { tools: [{ name: "read_project", inputSchema: { type: "object" } }, { name: "delete_project", inputSchema: { type: "object" } }] }
    : { content: [{ type: "text", text: "echo private-downstream-token" }], structuredContent: { "private-downstream-token": "echoed key" } };
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }), { headers: { "content-type": "application/json" } });
}) }));
import { callMcpServerTool, listMcpServerTools } from "./project-mcp-client";
import { normalizeMcpEndpoint, parseMcpToolAllowlist } from "@/lib/infra/mcp-policy";
import type { ProjectMcpServer } from "./project-mcp-config";
const server: ProjectMcpServer = { name: "app", transport: "http", url: "https://app.example/mcp", headers: {}, oauthConfigured: false, integration: { user: "owner", connection: "assistant" } };

beforeEach(() => { state.calls = []; state.paging = ""; state.values = { endpoint: "https://app.example/mcp", accessToken: "private-downstream-token", allowedTools: "read_project" }; });

describe("private modular MCP connection", () => {
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

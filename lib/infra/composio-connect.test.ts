import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));
type Call = { url: string; httpMethod: string; method: string; headers: Headers; params: Record<string, unknown> };
const state = vi.hoisted(() => ({ calls: [] as Call[], toolResult: null as unknown, toolError: "" }));
const reply = (id: unknown, payload: Record<string, unknown>, type = "application/json") =>
  new Response(type === "text/event-stream" ? `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n\n` : JSON.stringify({ jsonrpc: "2.0", id, ...payload }), { status: 200, headers: { "content-type": type } });
vi.mock("@/lib/host/ssrf", () => ({
  safeProviderFetch: vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id?: unknown; method: string; params?: Record<string, unknown> };
    state.calls.push({ url: String(url), httpMethod: String(init.method ?? "POST"), method: body.method, headers: new Headers(init.headers), params: body.params ?? {} });
    if (body.method === "server/discover") return reply(body.id, { error: { code: -32601, message: "Method not found" } });
    if (body.method === "initialize") return reply(body.id, { result: { protocolVersion: "2025-06-18", capabilities: { tools: {} } } }, "text/event-stream");
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") return reply(body.id, { result: { tools: [{ name: "COMPOSIO_SEARCH_TOOLS", description: "Search", inputSchema: { type: "object" } }, { name: "COMPOSIO_GET_TOOLKIT", description: "Toolkit", inputSchema: { type: "object" } }] } }, "text/event-stream");
    if (state.toolError) return reply(body.id, { error: { code: -32000, message: state.toolError } }, "text/event-stream");
    return reply(body.id, { result: state.toolResult }, "text/event-stream");
  }),
}));

import { callComposioConnectTool, composioConnectServer, listComposioConnectTools } from "./composio-connect";
import { composioKeyKind } from "./composio";

const TOKEN = "ck_synthetic_connect_token_1234567890";
const PLATFORM = "ak_synthetic_platform_key_1234567890";
const HOST = "connect.composio.dev";
const CONNECT = "https://connect.composio.dev/mcp";

beforeEach(() => { state.calls = []; state.toolError = ""; state.toolResult = { content: [{ type: "text", text: "ok" }], isError: false }; });
afterEach(() => vi.unstubAllGlobals());

describe("Composio Connect MCP client", () => {
  it("builds an in-memory HTTP server on the constant endpoint with the bearer token", () => {
    const server = composioConnectServer({ apiKey: TOKEN });
    expect(server).toMatchObject({ transport: "http", url: CONNECT, oauthConfigured: false });
    expect(server.headers).toEqual({ Authorization: "Bearer " + TOKEN });
    expect(new URL(server.url).hostname).toBe(HOST);
  });

  it("ignores any stored endpoint value: the URL is a constant, never caller input", () => {
    const server = composioConnectServer({ apiKey: TOKEN, endpoint: "https://attacker.invalid/mcp", url: "https://attacker.invalid/mcp" });
    expect(server.url).toBe(CONNECT);
  });

  it("lists tools over tools/list with the bearer and SSE accept, parsing the SSE body", async () => {
    const listed = await listComposioConnectTools({ apiKey: TOKEN });
    expect(listed.tools.map((tool) => tool.name)).toEqual(["COMPOSIO_GET_TOOLKIT", "COMPOSIO_SEARCH_TOOLS"]);
    const list = state.calls.find((call) => call.method === "tools/list")!;
    expect(list.url).toBe(CONNECT);
    expect(list.headers.get("authorization")).toBe("Bearer " + TOKEN);
    expect(list.httpMethod).toBe("POST");
    expect(list.headers.get("accept")).toContain("text/event-stream");
    for (const call of state.calls) expect(new URL(call.url).hostname).toBe(HOST);
  });

  it("calls tools/call with the exact name and arguments", async () => {
    await callComposioConnectTool({ apiKey: TOKEN }, "COMPOSIO_SEARCH_TOOLS", { query: "deploy" });
    const call = state.calls.find((row) => row.method === "tools/call")!;
    expect(call.url).toBe(CONNECT);
    expect(call.params).toMatchObject({ name: "COMPOSIO_SEARCH_TOOLS", arguments: { query: "deploy" } });
    expect(call.headers.get("authorization")).toBe("Bearer " + TOKEN);
  });

  it("redacts the token echoed by an upstream error", async () => {
    state.toolError = `invalid credential ${TOKEN} for this server`;
    const failure = await callComposioConnectTool({ apiKey: TOKEN }, "COMPOSIO_SEARCH_TOOLS", {}).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain("[redacted]");
    expect(String(failure)).not.toContain(TOKEN);
  });

  it("redacts the token echoed inside a successful tool result", async () => {
    state.toolResult = { content: [{ type: "text", text: `session ${TOKEN} active` }], meta: { token: TOKEN } };
    const result = await callComposioConnectTool({ apiKey: TOKEN }, "COMPOSIO_SEARCH_TOOLS", {});
    expect(JSON.stringify(result)).toContain("[redacted]");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("refuses a Platform key before any request, so it never reaches connect.composio.dev", async () => {
    expect(composioKeyKind({ apiKey: PLATFORM })).toBe("project");
    await expect(listComposioConnectTools({ apiKey: PLATFORM })).rejects.toMatchObject({ code: "composio_connect_key_required" });
    await expect(callComposioConnectTool({ apiKey: PLATFORM }, "COMPOSIO_SEARCH_TOOLS", {})).rejects.toMatchObject({ code: "composio_connect_key_required" });
    await expect(listComposioConnectTools({})).rejects.toMatchObject({ code: "composio_connect_key_required" });
    expect(state.calls).toHaveLength(0);
  });

  it("rejects an invalid tool name with the MCP client's own shape", async () => {
    await expect(callComposioConnectTool({ apiKey: TOKEN }, "bad name!", {})).rejects.toMatchObject({ code: "invalid_tool_arguments" });
    expect(state.calls).toHaveLength(0);
  });
});

/** Every test owns a fresh store: the storage path is resolved at module load, so reset modules too. */
let root = "";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-composio-connect-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  process.env.VITEST = "1";
  vi.resetModules();
});
afterEach(async () => { delete process.env.OS_INFRA_STORE; delete process.env.VITEST; await fs.rm(root, { recursive: true, force: true }); });

async function broker(key?: string) {
  const { integrationManage } = await import("./connection-manage");
  const service = await import("./connection-service");
  await integrationManage({ action: "user.create", user: "owner", confirm: true });
  await integrationManage({ action: "connection.create", user: "owner", provider: "composio", connection: "broker", source: "direct", authMethod: "project", confirm: true });
  await integrationManage({ action: "connection.create", user: "owner", provider: "github", connection: "work", source: "composio", authMethod: "oauth2", confirm: true });
  if (!key) return;
  const snapshot = await service.credentialSnapshot("composio", { user: "owner", connection: "broker" });
  await service.saveConnectionValues("composio", { user: "owner", connection: "broker" }, { apiKey: key }, snapshot.connection);
}

describe("Composio routing by key kind", () => {
  it("routes a ck_ key to Connect for both operations and never to the Platform API", async () => {
    await broker(TOKEN);
    const platformUrls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL) => { platformUrls.push(String(url)); return new Response("{}", { status: 200 }); }));
    const { executeIntegrationAction } = await import("./connection-dispatch");
    const listed = await executeIntegrationAction({ user: "owner", provider: "composio", operation: "composio.tools.list", connection: "broker", confirm: true }) as { tools: { name: string }[] };
    expect(listed.tools.map((tool) => tool.name)).toEqual(["COMPOSIO_GET_TOOLKIT", "COMPOSIO_SEARCH_TOOLS"]);
    const called = await executeIntegrationAction({ user: "owner", provider: "composio", operation: "composio.tool", connection: "broker", tool: "COMPOSIO_SEARCH_TOOLS", arguments: { query: "x" }, confirm: true });
    expect(JSON.stringify(called)).toContain("ok");
    expect(platformUrls).toHaveLength(0);
    expect(state.calls.length).toBeGreaterThan(0);
    for (const call of state.calls) expect(new URL(call.url).hostname).toBe(HOST);
    // A Connect credential is not a Platform credential for any other provider route.
    await expect(executeIntegrationAction({ user: "owner", provider: "github", connection: "work", operation: "composio.tool", tool: "GITHUB_GET_THE_AUTHENTICATED_USER", arguments: {}, confirm: true }))
      .rejects.toMatchObject({ code: "provider_operation_mismatch" });
  });

  it("routes an ak_ key to the Platform path for both operations and never to connect", async () => {
    await broker(PLATFORM);
    const platformUrls: string[] = [];
    let remoteUser = "";
    vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url); platformUrls.push(href);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (href.includes("/tools/execute/")) return new Response(JSON.stringify({ data: { login: "octo" } }), { status: 200 });
      if (href.endsWith("/connected_accounts/link")) { remoteUser = String(body.user_id); return new Response(JSON.stringify({ connected_account_id: "ca_1", redirect_url: "https://connect.composio.dev/link/x" }), { status: 200 }); }
      if (href.includes("/connected_accounts/")) return new Response(JSON.stringify({ id: "ca_1", toolkit: { slug: "github" }, auth_config: { id: "ac_1" }, user_id: remoteUser, status: "ACTIVE" }), { status: 200 });
      if (href.includes("/auth_configs/")) return new Response(JSON.stringify({ id: "ac_1", toolkit: { slug: "github" }, auth_scheme: "OAUTH2", status: "ENABLED" }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
    const external = await import("./connection-external");
    await external.authorizeIntegration("github", { user: "owner", connection: "work" }, { authConfigId: "ac_1", brokerConnection: "broker" });
    await external.verifyExternalIntegration("github", { user: "owner", connection: "work" });
    const { executeIntegrationAction } = await import("./connection-dispatch");
    const result = await executeIntegrationAction({ user: "owner", provider: "github", connection: "work", operation: "composio.tool", tool: "GITHUB_GET_THE_AUTHENTICATED_USER", arguments: {}, confirm: true });
    expect(JSON.stringify(result)).toContain("octo");
    expect(platformUrls.length).toBeGreaterThan(0);
    for (const href of platformUrls) expect(new URL(href).hostname).toBe("backend.composio.dev");
    expect(state.calls).toHaveLength(0);
  });

  it("refuses tools.list on a Platform key instead of reusing the tool-call path", async () => {
    await broker(PLATFORM);
    const { executeIntegrationAction } = await import("./connection-dispatch");
    await expect(executeIntegrationAction({ user: "owner", provider: "composio", connection: "broker", operation: "composio.tools.list", confirm: true }))
      .rejects.toMatchObject({ code: "composio_tools_list_requires_connect_key", status: 409 });
    expect(state.calls).toHaveLength(0);
  });

  it("fails closed with composio_project_key_required when no Composio key is stored", async () => {
    await broker();
    const { executeIntegrationAction } = await import("./connection-dispatch");
    await expect(executeIntegrationAction({ user: "owner", provider: "composio", operation: "composio.tools.list", connection: "broker", confirm: true }))
      .rejects.toMatchObject({ code: "composio_project_key_required", status: 409 });
    expect(state.calls).toHaveLength(0);
  });
});

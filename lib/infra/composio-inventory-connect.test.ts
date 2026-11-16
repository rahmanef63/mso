import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ calls: [] as { method: string; headers: Headers; params: unknown }[] }));
const KEY = "ck_synthetic_selected_study_key";
vi.mock("@/lib/host/ssrf", () => ({ safeProviderFetch: vi.fn(async (url: string, init: RequestInit) => {
  expect(new URL(url).hostname).toBe("connect.composio.dev");
  const body = JSON.parse(String(init.body));
  state.calls.push({ method: body.method, headers: new Headers(init.headers), params: body.params });
  const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
  if (body.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "unsupported" } });
  if (body.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
  if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (body.method === "tools/list") return reply({ tools: [{ name: "COMPOSIO_SEARCH_TOOLS", description: KEY, inputSchema: { type: "object", properties: { queries: { type: "array" } }, required: ["queries"] } }] });
  return reply({ content: [{ type: "text", text: "metadata only" }] });
}) }));
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-connect-inventory-")); vi.stubEnv("OS_INFRA_STORE", path.join(root, "infra.json")); state.calls = []; vi.resetModules(); });
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const { integrationManage: manage } = await import("./connection-manage");
  const service = await import("./connection-service");
  await manage({ action: "user.create", user: "owner", confirm: true });
  for (const [connection, apiKey] of [["default", "ak_synthetic_unrelated_default"], ["study", KEY]]) {
    await manage({ action: "connection.create", user: "owner", provider: "composio", connection, source: "direct", authMethod: "project", confirm: true });
    const snap = await service.credentialSnapshot("composio", { user: "owner", connection });
    await service.saveConnectionValues("composio", { user: "owner", connection }, { apiKey }, snap.connection);
  }
  return import("./connection-dispatch");
}
it("discovers safe Connect schemas through the exact named key without a Platform request", async () => {
  const { queryIntegrationAction: query } = await fixture();
  const platform = vi.fn(); vi.stubGlobal("fetch", platform);
  const before = await fs.readFile(process.env.OS_INFRA_STORE!, "utf8");
  const result = await query({ view: "broker", user: "owner", provider: "composio", connection: "study" });
  expect(result).toMatchObject({ keyKind: "connect", complete: true, nextCursor: null, tools: [{ name: "COMPOSIO_SEARCH_TOOLS", description: "[redacted]", inputSchema: { required: ["queries"] } }] });
  expect(JSON.stringify(result)).not.toContain(KEY);
  expect(platform).not.toHaveBeenCalled();
  for (const call of state.calls) expect(call.headers.get("authorization")).toBe("Bearer " + KEY);
  expect(await fs.readFile(process.env.OS_INFRA_STORE!, "utf8")).toBe(before);
});
it("uses the selected Connect connection when calling a discovered tool", async () => {
  const { executeIntegrationAction: execute } = await fixture();
  const result = await execute({ operation: "composio.tool", tool: "COMPOSIO_SEARCH_TOOLS", arguments: { queries: [] }, user: "owner", provider: "composio", connection: "study", confirm: true });
  expect(JSON.stringify(result)).toContain("metadata only");
  const call = state.calls.find(row => row.method === "tools/call");
  expect(call?.headers.get("authorization")).toBe("Bearer " + KEY);
  expect(call?.params).toMatchObject({ name: "COMPOSIO_SEARCH_TOOLS", arguments: { queries: [] } });
});
it("rejects another connection's cursor instead of crossing its credential boundary", async () => {
  const { queryIntegrationAction: query } = await fixture();
  await expect(query({ view: "broker", user: "owner", provider: "composio", connection: "study", cursor: "not-a-valid-cursor" })).rejects.toThrow(/cursor/);
  expect(state.calls).toHaveLength(0);
});

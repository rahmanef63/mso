import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
let root: string;
const access = "SYNTHETIC_GOOGLE_ACCESS_NOT_REAL";
const secret = "SYNTHETIC_GOOGLE_CLIENT_SECRET";
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-google-mcp-contract-"));
  vi.resetModules(); vi.stubEnv("OS_INFRA_STORE", path.join(root, "infra.json")); vi.stubEnv("OS_PUBLIC_ORIGIN", "https://mso.example.test");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected external network in fixture")));
  const { integrationManage } = await import("@/lib/infra/connection-manage");
  await integrationManage({ action: "user.create", user: "fixture", confirm: true });
  await integrationManage({ action: "connection.create", user: "fixture", provider: "google-oauth-app", connection: "app", source: "direct", authMethod: "oauth-app", confirm: true });
  await integrationManage({ action: "connection.create", user: "fixture", provider: "google-search-console", connection: "search", source: "direct", authMethod: "oauth2", confirm: true });
  const { mutateIntegrationState } = await import("@/lib/infra/connection-storage");
  await mutateIntegrationState(d => {
    const app = d.users.fixture.connections["google-oauth-app"].app, c = d.users.fixture.connections["google-search-console"].search;
    app.values = { clientId: "123456789-fixture.apps.googleusercontent.com", clientSecret: secret }; c.values = { appConnection: "app" };
    c.googleOAuth = { appConnection: app.id, appUid: app.uid, appRevision: app.revision, redirectUri: "https://mso.example.test/api/integrations/google/callback", state: "connected", subject: "fixture-account", email: "owner@example.test", accessToken: access, refreshToken: "SYNTHETIC_REFRESH_NOT_REAL", scopes: ["https://www.googleapis.com/auth/webmasters.readonly"], expiresAt: Date.now() + 3600000, updatedAt: Date.now() };
  });
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); await rm(root, { recursive: true, force: true }); });
type Wire = { isError?: boolean; content?: unknown; structuredContent?: { result?: Record<string, unknown>; setup?: Record<string, unknown> }; _meta?: { integrationSetup?: { token?: string } } };
async function call(name: string, args: Record<string, unknown>, profile: "full" | "chatgpt" = "chatgpt", scope: "read" | "write" | "exec" = "exec") {
  const { dispatch } = await import("./dispatch");
  const response = await dispatch({ id: 1, method: "tools/call", params: { name, arguments: args } }, scope, "test", { principal: "mcp-client:native-google-contract", sessionId: "native-google-contract", toolProfile: profile });
  return { error: response.error, result: response.result as Wire | undefined };
}
it.each(["full", "chatgpt"] as const)("publishes every native Google operation and setup method in the actual %s descriptor", async profile => {
  const { dispatch } = await import("./dispatch"), { GOOGLE_READ_OPERATIONS } = await import("@/lib/infra/google-api-catalog");
  const listed = await dispatch({ id: 1, method: "tools/list" }, "exec", "test", { principal: "mcp-client:native-google-contract", sessionId: "native-google-contract", toolProfile: profile });
  const tools = (listed.result as { tools: { name: string; inputSchema: { properties: Record<string, { enum?: string[] }> } }[] }).tools;
  const operations = tools.find(t => t.name === "integration_execute")!.inputSchema.properties.operation.enum;
  expect(operations).toEqual(expect.arrayContaining([...GOOGLE_READ_OPERATIONS.map(row => row.name), "google.bind", "google.disconnect", "google.operations.list"]));
  const setup = tools.find(t => t.name === "integration_setup_open")!.inputSchema.properties;
  expect(setup.provider.enum).toContain("google-oauth-app"); expect(setup.method.enum).toContain("oauth-app");
  expect(setup.provider.enum).not.toContain("google-search-console"); expect(setup.method.enum).not.toContain("oauth2");
});
it.each(["full", "chatgpt"] as const)("runs Google through actual %s MCP schema validation and shared dispatch", async profile => {
  const ops = await call("integration_execute", { user: "fixture", provider: "google-search-console", connection: "search", operation: "google.operations.list", confirm: true }, profile);
  expect(ops.error).toBeUndefined(); expect(ops.result?.isError).not.toBe(true);
  expect(ops.result?.structuredContent?.result?.operations).toHaveLength(4);
  const siteEntry = [{ siteUrl: "sc-domain:example.test", permissionLevel: "siteOwner" }];
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ siteEntry }), { headers: { "content-type": "application/json" } }));
  const reply = await call("integration_execute", { user: "fixture", provider: "google-search-console", connection: "search", operation: "google.searchConsole.sites.list", arguments: {}, confirm: true }, profile);
  expect(reply.error).toBeUndefined(); expect(reply.result?.isError).not.toBe(true);
  expect(reply.result?.structuredContent?.result).toMatchObject({ user: "fixture", provider: "google-search-console", source: "direct", authMethod: "oauth2", readOnly: true, result: { siteEntry } });
  expect(String(vi.mocked(fetch).mock.lastCall?.[0])).toBe("https://www.googleapis.com/webmasters/v3/sites");
  expect(JSON.stringify(reply.result)).not.toContain(access); expect(JSON.stringify(reply.result)).not.toContain(secret);
});
it("preserves MSO exec scope even though the Google action itself is read-only", async () => {
  const reply = await call("integration_execute", { user: "fixture", provider: "google-search-console", connection: "search", operation: "google.searchConsole.sites.list", confirm: true }, "chatgpt", "read");
  expect(reply.error || reply.result?.isError).toBeTruthy(); expect(fetch).not.toHaveBeenCalled();
});
it("returns only a native UI handoff, never an OAuth state or authorization code", async () => {
  const reply = await call("integration_manage", { action: "connection.authorize", user: "fixture", provider: "google-search-console", connection: "search", confirm: true });
  expect(reply.error).toBeUndefined(); expect(reply.result?.structuredContent?.result).toMatchObject({ authorization: "owner-browser-required" });
  expect(String(reply.result?.structuredContent?.result?.openPath)).toContain("https://mso.example.test/integrations?");
  expect(JSON.stringify(reply.result)).not.toMatch(/code_challenge|code_verifier|accounts\.google\.com|SYNTHETIC_GOOGLE/); expect(fetch).not.toHaveBeenCalled();
});
it.each(["full", "chatgpt"] as const)("supports explicit oauth-app setup in %s while keeping setup authority UI-private", async profile => {
  const reply = await call("integration_setup_open", { user: "fixture", provider: "google-oauth-app", connection: "app", method: "oauth-app" }, profile, "write");
  expect(reply.error).toBeUndefined(); expect(reply.result?.isError).not.toBe(true);
  expect(reply.result?.structuredContent?.setup).toMatchObject({ provider: "google-oauth-app", method: "oauth-app", redirectUri: "https://mso.example.test/api/integrations/google/callback" });
  const token = reply.result?._meta?.integrationSetup?.token; expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(JSON.stringify(reply.result?.content)).not.toContain(token); expect(JSON.stringify(reply.result?.structuredContent)).not.toContain(token);
  expect(JSON.stringify(reply.result?.structuredContent)).not.toContain(secret);
});

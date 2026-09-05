import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/host/audit-api", () => ({ audit: vi.fn() }));
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-setup-route-")); process.env.OS_INFRA_STORE = path.join(root, "infra.json"); vi.resetModules(); });
afterEach(async () => { delete process.env.OS_INFRA_STORE; await fs.rm(root, { recursive: true, force: true }); vi.resetModules(); });
const endpoint = "https://mso.rahmanef.com/api/integrations/setup";
function req(token: string, origin = "https://mso-ui.rahmanef.com", body: unknown = { action: "schema" }) {
  return new NextRequest(endpoint, { method: "POST", headers: { origin, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}
it("allows only exact trusted Origins and never grants credentialed CORS", async () => {
  const { OPTIONS, POST } = await import("./route");
  const good = OPTIONS(new NextRequest(endpoint, { method: "OPTIONS", headers: { origin: "https://mso-ui.rahmanef.com" } }));
  expect(good.status).toBe(204); expect(good.headers.get("access-control-allow-origin")).toBe("https://mso-ui.rahmanef.com");
  expect(good.headers.has("access-control-allow-credentials")).toBe(false);
  for (const origin of ["https://evil.invalid", "https://mso-ui.rahmanef.com.evil.invalid", "null"]) expect((await POST(req("x".repeat(43), origin))).status).toBe(403);
  expect((await POST(req("x".repeat(43)))).status).toBe(401);
});
it("safe schema is capability protected and secret fields have no prefill", async () => {
  const { openIntegrationSetup } = await import("@/lib/infra/setup-capability"), { POST } = await import("./route");
  const {integrationManage}=await import("@/lib/infra/connection-manage");
  await integrationManage({action:"user.create",confirm:true,user:"test-owner"});
  await integrationManage({action:"connection.create",confirm:true,user:"test-owner",provider:"composio",connection:"project",authMethod:"project"});
  const grant = await openIntegrationSetup("composio", "test-owner", "project",{user:"test-owner",connection:"project"});
  const response = await POST(req(grant.token)); expect(response.status).toBe(200);
  const text = await response.text(); expect(text).not.toContain(grant.token); expect(text).not.toContain('"value":');
  expect((await POST(req(grant.token, undefined, { action: "schema", provider: "hostinger" }))).status).toBe(400);
});
it("rejects oversized and non-JSON body before invoking any provider", async () => {
  const { POST } = await import("./route");
  expect((await POST(req("x".repeat(43), undefined, { action: "save", values: { apiKey: "x".repeat(18000) } }))).status).toBe(413);
  const input = req("x".repeat(43)); input.headers.set("content-type", "text/plain"); expect((await POST(input)).status).toBe(415);
});
it("serves uncached, unframeable HTML without an authenticated key", async () => {
  const { GET } = await import("./route"); const response = GET();
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});

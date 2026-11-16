import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
let root: string;
const selectedKey = "ak_synthetic_study_key", defaultKey = "ak_synthetic_default_key";
const input = { view: "broker", user: "alice", provider: "composio", connection: "study" };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-composio-inventory-"));
  vi.stubEnv("OS_INFRA_STORE", path.join(root, "infra.json"));
  vi.resetModules();
});
afterEach(async () => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const { integrationManage } = await import("./connection-manage");
  const { credentialSnapshot, saveConnectionValues } = await import("./connection-service");
  for (const user of ["alice", "bob"]) {
    await integrationManage({ action: "user.create", user, confirm: true });
    for (const connection of ["default", "study"]) {
      await integrationManage({ action: "connection.create", user, provider: "composio", connection, source: "direct", authMethod: "project", confirm: true });
      const snap = await credentialSnapshot("composio", { user, connection });
      await saveConnectionValues("composio", { user, connection }, { apiKey: user === "alice" && connection === "study" ? selectedKey : defaultKey }, snap.connection);
    }
  }
  const { queryIntegrationAction } = await import("./connection-dispatch");
  return queryIntegrationAction;
}
const page = (next_cursor: string | null = null) => ({ items: [
  { id: "ca_study", toolkit: { slug: "posthog" }, status: "ACTIVE", auth_config: { id: "ac_study", api_key: "upstream-secret" }, user_id: "study-owner", state: { access_token: "upstream-secret" } },
  { id: "ca_mcp", toolkit: { slug: "posthog_mcp" }, status: "ACTIVE", user_id: "study-owner", data: { token: "upstream-secret" } },
], next_cursor });
it("uses the exact named project key and returns only account metadata without rewriting the store", async () => {
  const query = await fixture();
  const before = await fs.readFile(process.env.OS_INFRA_STORE!, "utf8");
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("x-api-key")).toBe(selectedKey);
    expect(String(_url)).toBe("https://backend.composio.dev/api/v3.1/connected_accounts?limit=50");
    return Response.json(page());
  });
  vi.stubGlobal("fetch", fetcher);
  const result = await query({ ...input, workflow_id: "exact-flow" });
  expect(result).toMatchObject({ user: "alice", connection: "study", complete: true, nextCursor: null });
  expect(JSON.stringify(result)).not.toMatch(/upstream-secret|ak_synthetic/);
  expect(result).toMatchObject({ accounts: [
    { id: "ca_study", toolkit: "posthog", status: "ACTIVE", authConfigId: "ac_study", userId: "study-owner" },
    { id: "ca_mcp", toolkit: "posthog_mcp", status: "ACTIVE", authConfigId: null, userId: "study-owner" },
  ] });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(await fs.readFile(process.env.OS_INFRA_STORE!, "utf8")).toBe(before);
});
it("preserves cursor pagination and keeps cursor content in a fixed-host query parameter", async () => {
  const query = await fixture();
  const fetcher = vi.fn(async (_url: RequestInfo | URL) => Response.json(page("second/page?x=1")));
  vi.stubGlobal("fetch", fetcher);
  expect(await query(input)).toMatchObject({ complete: false, nextCursor: "second/page?x=1" });
  await query({ ...input, cursor: "second/page?x=1" });
  expect(String(fetcher.mock.calls[1][0])).toContain("cursor=second%2Fpage%3Fx%3D1");
});
it.each([401, 403, 500])("returns a fixed error for provider HTTP%s without echoing credentials or bodies", async status => {
  const query = await fixture();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(selectedKey + " upstream-secret", { status })));
  await expect(query(input)).rejects.toMatchObject({ code: `composio_http_${status}` });
});
it("contains network exceptions without provider details", async () => {
  const query = await fixture();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(selectedKey); }));
  await expect(query(input)).rejects.toMatchObject({ code: "composio_inventory_unreachable" });
});
it.each([{ items: "invalid" }, { items: [{}] }, { items: [], has_more: true }, { items: [], next_cursor: 12 }])("fails closed on incomplete or malformed pages: %j", async body => {
  const query = await fixture();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
  await expect(query(input)).rejects.toMatchObject({ code: "invalid_composio_inventory" });
});
it("refuses missing identities, another provider and extra fields before any provider request", async () => {
  const query = await fixture();
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const bad of [{ ...input, user: undefined }, { ...input, connection: undefined }, { ...input, connection: "missing" }, { ...input, provider: "github" }, { ...input, endpoint: "https://attacker.invalid" }, { ...input, cursor: "" }])
    await expect(query(bad)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not leak a stored key echoed in an otherwise permitted metadata field", async () => {
  const query = await fixture();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items: [{ id: "ca_" + selectedKey, status: selectedKey }], next_cursor: null })));
  expect(JSON.stringify(await query(input))).not.toContain(selectedKey);
});
it("bounds provider requests per named connection", async () => {
  const query = await fixture(); const fetcher = vi.fn(async () => Response.json(page())); vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 20; i++) await query(input);
  await expect(query(input)).rejects.toMatchObject({ code: "rate_limited" });
  expect(fetcher).toHaveBeenCalledTimes(20);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import { alice, bindingA, fixture } from "@/lib/tenancy/persistence-test-fixtures";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => ({ records: new Map<string, Record<string, unknown>>(), touch: vi.fn(), client: vi.fn() }));
type McpStore = typeof import("@/lib/mcp/store");
vi.mock("@/lib/mcp/store", async importOriginal => {
  const actual = await importOriginal<McpStore>();
  return {
    ...actual,
    validateToken: async (bearer: string) => auth.records.get(bearer) ?? null,
    touchToken: auth.touch, getClient: auth.client,
  };
});
let f: Awaited<ReturnType<typeof fixture>>, post: typeof import("./route").POST;
let ownerRuns: Array<() => void> = [];
const cleanup: Array<() => Promise<void>> = [];
function request(name: string, args = {}, token = "fixture-A") {
  return new Request("https://tenant.fixture.invalid/mcp", { method: "POST", headers: {
    authorization: "Bearer " + token, "content-type": "application/json", "Mso-Session-Id": "other-session",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name, arguments: args, _meta: { tenantId: "tenant-b", user: "bob", path: "/foreign" } } }) });
}
const call = async (name: string, args = {}, token = "fixture-A") => {
  const response = await post(request(name, args, token));
  return { status: response.status, body: await response.json() };
};
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); ownerRuns = [];
  f = await fixture(); auth.records.clear();
  for (const [raw, identity, hash] of [["fixture-A", alice, "a"], ["fixture-B", { ...alice, subject: "bob" }, "b"]] as const) {
    const b = (await f.store.registry.resolve(identity))!;
    auth.records.set(raw, { hash: hash.repeat(64), label: "synthetic", clientId: "shared-client", scope: "write",
      resource: "https://tenant.fixture.invalid/mcp", profile: "full", expiresAt: identity.expiresAt,
      tenantBinding: { version: 1, issuer: identity.issuer, subject: identity.subject,
        tenantId: b.tenantId, principalId: b.principalId, mappingRevision: b.mappingRevision } });
  }
  vi.stubEnv("OS_MCP_ENABLED", "1"); vi.stubEnv("NEXT_PUBLIC_OS_DEMO", "0");
  vi.stubEnv("OS_MCP_MAX_SCOPE", "exec"); vi.stubEnv("OS_PUBLIC_ORIGIN", "https://tenant.fixture.invalid");
  vi.stubEnv("OS_TENANCY_MODE", "tenant-preview"); vi.stubEnv("OS_TENANCY_STORAGE_ROOT", f.root);
  post = (await import("./route")).POST;
  const { TOOLS_BY_NAME } = await import("@/lib/mcp/tools");
  ownerRuns = ["agent_memory_read", "agent_memory_search", "agent_memory_remember", "agent_memory_forget"]
    .map(name => { const spy = vi.spyOn(TOOLS_BY_NAME.get(name)!, "run");
      return () => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); }; });
});
afterEach(async () => {
  for (const check of ownerRuns) check();
  expect(auth.touch).not.toHaveBeenCalled(); expect(auth.client).not.toHaveBeenCalled();
  vi.unstubAllEnvs(); await f.cleanup(); for (const fn of cleanup.splice(0)) await fn();
});
it("runs actual POST, composition, dispatcher and kernel against two durable namespaces", async () => {
  const write = (value: string, token: string) => call("agent_memory_remember", { document: "MEMORY.md", key: "private-key", value }, token);
  for (const result of await Promise.all([write("private-A", "fixture-A"), write("private-B", "fixture-B")])) {
    expect(result.status).toBe(200); expect(result.body.error).toBeUndefined(); expect(result.body.result.isError).not.toBe(true);
  }
  const a = JSON.stringify((await call("agent_memory_read")).body);
  const b = JSON.stringify((await call("agent_memory_read", {}, "fixture-B")).body);
  expect(a).toContain("private-A"); expect(a).not.toContain("private-B");
  expect(b).toContain("private-B"); expect(b).not.toContain("private-A");
  const state = JSON.parse(await fs.readFile(f.root + "/state.json", "utf8"));
  expect(state.audit).toHaveLength(4);
  for (const value of ["private-key", "private-A", "private-B", "fixture-A", "fixture-B"]) expect(JSON.stringify(state.audit)).not.toContain(value);
  expect(JSON.stringify((await call("agent_memory_search", { query: "private-key" })).body)).toContain("private-A");
  expect((await call("agent_memory_forget", { document: "MEMORY.md", key: "private-key" })).body.error).toBeUndefined();
  expect(JSON.stringify((await call("agent_memory_read")).body)).not.toContain("private-A");
});
it.each([{ tenantId: "tenant-b" }, { user: "bob" }, { path: "/foreign" }, { document: "CLAIMS.v1" }])("rejects argument selectors %j without mutation", async extra => {
  const result = await call("agent_memory_remember", { document: "MEMORY.md", key: "safe", value: "safe", ...extra });
  expect(result.body.error?.code).toBe(-32602);
  expect(await f.store.administration.status()).toEqual({ revision: 2, auditEntries: 2 });
});
it("enforces read scope, token allowlists and argument constraints before writes", async () => {
  const token = auth.records.get("fixture-A")!;
  for (const policy of [{ scope: "read" }, { scope: "write", allowedTools: ["agent_memory_read"] },
    { scope: "write", allowedTools: ["agent_memory_remember"], toolArgumentConstraints: { agent_memory_remember: { document: ["USER.md"] } } }]) {
    Object.assign(token, policy);
    const result = await call("agent_memory_remember", { document: "MEMORY.md", key: "safe", value: "safe" });
    expect(result.body.error || result.body.result?.isError).toBeTruthy();
  }
  expect(await f.store.administration.status()).toEqual({ revision: 2, auditEntries: 2 });
});
it("denies stale credentials after durable revoke and re-enable", async () => {
  await call("agent_memory_read");
  await f.store.administration.setBinding(alice, { ...bindingA, enabled: false }, 2);
  expect((await call("agent_memory_read")).status).toBe(401);
  await f.store.administration.setBinding(alice, bindingA, 3);
  expect((await call("agent_memory_read")).status).toBe(401);
});
it("denies permission drift without exposing the configured path", async () => {
  await call("agent_memory_read");
  await fs.chmod(f.root + "/state.json", 0o644);
  const denied = await call("agent_memory_read");
  expect(denied.status).toBe(401); expect(JSON.stringify(denied.body)).not.toContain(f.root);
});
it("refuses unsupported host/app tools before legacy execution", async () => {
  for (const name of ["exec_run", "fs_read", "browser_status", "apps_power", "integration_execute"]) {
    expect((await call(name)).body.error).toBeDefined();
  }
  expect(await f.store.administration.status()).toEqual({ revision: 2, auditEntries: 2 });
});
it("denies a changed server root without creating replacement storage", async () => {
  await call("agent_memory_read");
  const other = f.root + "-other"; await fs.mkdir(other, { mode: 0o700 }); cleanup.push(() => fs.rm(other, { recursive: true, force: true }));
  vi.stubEnv("OS_TENANCY_STORAGE_ROOT", other);
  expect((await call("agent_memory_read")).status).toBe(401);
  expect(await fs.readdir(other)).toEqual([]);
});

import { afterAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-durable-grant-"));
process.env.OS_MCP_STORE = path.join(root, "mcp.json");
process.env.OS_MCP_MAX_SCOPE = "exec";
const store = await import("./store");
const state = await import("./store-state");
const { authorizeDurableGrant, mcpAuthorizationGrant } = await import("./durable-grant");
afterAll(async () => { delete process.env.OS_MCP_STORE; delete process.env.OS_MCP_MAX_SCOPE; await rm(root, { recursive: true, force: true }); });

it("rechecks token identity, scope, resource, tool/argument limits, expiry and revocation", async () => {
  await store.storeToken("credential", { clientId: "durable", label: "worker", scope: "exec", resource: "https://fixture.test/mcp", allowedTools: ["project_agent_run"], toolArgumentConstraints: { project_agent_run: { project: ["reviewed"] } } });
  const token = (await store.validateToken("credential"))!, grant = mcpAuthorizationGrant(token, token.resource!);
  if (grant.kind !== "mcp") throw new Error("fixture grant kind");
  const check = (name = "project_agent_run", args = { project: "reviewed" }) => authorizeDurableGrant(grant, "mcp-client:durable", name, args);
  expect(await check()).toBe(true);
  expect(await check("host_exec")).toBe(false);
  expect(await check("project_agent_run", { project: "other" })).toBe(false);
  expect(await authorizeDurableGrant(grant, "mcp-client:other")).toBe(false);
  expect(await authorizeDurableGrant({ ...grant, resource: "https://other.test/mcp" }, "mcp-client:durable")).toBe(false);
  await state.mutateMcpStore(async () => { const current = await state.readMcpStore(); current.tokens[token.hash].expiresAt = Date.now() - 1; await state.commitMcpStore(current); });
  expect(await check()).toBe(false);
  await store.storeToken("credential", { clientId: "durable", label: "replacement", scope: "exec" });
  expect(await check()).toBe(false);
  const fresh = (await store.validateToken("credential"))!, freshGrant = mcpAuthorizationGrant(fresh, "https://fixture.test/mcp");
  expect(await authorizeDurableGrant(freshGrant, "mcp-client:durable")).toBe(true);
  await store.revokeToken(fresh.hash);
  expect(await authorizeDurableGrant(freshGrant, "mcp-client:durable")).toBe(false);
});

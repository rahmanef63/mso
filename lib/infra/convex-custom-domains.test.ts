import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const PAT = "pat_synthetic_12345678901234567890";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-domain-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});
async function seeded() {
  const { integrationManage } = await import("./connection-manage");
  await integrationManage({
    action: "user.create",
    user: "alice",
    confirm: true,
  });
  await integrationManage({
    action: "connection.create",
    user: "alice",
    provider: "convex-cloud",
    connection: "admin",
    authMethod: "personal",
    source: "direct",
    confirm: true,
  });
  const { withIntegrationSelection } = await import("./connection-service"),
    { setInfraProvider } = await import("./store");
  await withIntegrationSelection({ user: "alice", connection: "admin" }, () =>
    setInfraProvider("convex-cloud", { personalToken: PAT }),
  );
  return withIntegrationSelection;
}
const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
it("idempotently creates a custom domain using the official destination contract", async () => {
  const withSelection = await seeded();
  let created = false;
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${PAT}`,
      );
      if (url.endsWith("/custom_domains") && init?.method === "GET")
        return json({
          domains: created
            ? [
                {
                  domain: "api.example.com",
                  deploymentName: "happy-otter-123",
                  requestDestination: "convexCloud",
                  creationTime: 1,
                  verificationTime: null,
                },
              ]
            : [],
        });
      if (url.endsWith("/create_custom_domain")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          domain: "api.example.com",
          requestDestination: "convexCloud",
        });
        created = true;
        return json(null);
      }
      return json({ error: "unexpected" }, 500);
    },
  );
  const { ensureConvexCustomDomain } = await import("./convex-custom-domains");
  const first = await withSelection(
    { user: "alice", connection: "admin" },
    () =>
      ensureConvexCustomDomain(
        {
          deploymentName: "happy-otter-123",
          domain: "API.EXAMPLE.COM",
          requestDestination: "convexCloud",
        },
        fetchImpl,
      ),
  );
  expect(first).toMatchObject({
    changed: true,
    dns: { type: "CNAME", name: "api.example.com", content: "convex.domains" },
  });
  const second = await withSelection(
    { user: "alice", connection: "admin" },
    () =>
      ensureConvexCustomDomain(
        {
          deploymentName: "happy-otter-123",
          domain: "api.example.com",
          requestDestination: "convexCloud",
        },
        fetchImpl,
      ),
  );
  expect(second.changed).toBe(false);
  expect(JSON.stringify({ first, second })).not.toContain(PAT);
});

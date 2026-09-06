import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const PAT = "pat_synthetic_12345678901234567890";
const DEPLOY_KEY = "prod:happy-otter-123|synthetic_deploy_key_1234567890";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-canonical-"));
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
it("reads canonical URLs through a scoped short-lived deploy key and deletes it", async () => {
  const withSelection = await seeded();
  const seen: string[] = [];
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/create_deploy_key")) {
        expect(JSON.parse(String(init?.body)).allowedActions).toEqual([
          "deployment:env:view",
          "deployment:env:write",
        ]);
        return json({ deployKey: DEPLOY_KEY });
      }
      if (url.endsWith("/get_canonical_urls")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Convex ${DEPLOY_KEY}`,
        );
        return json({
          convexCloudUrl: "https://happy-otter-123.convex.cloud",
          convexSiteUrl: "https://happy-otter-123.convex.site",
        });
      }
      if (url.endsWith("/delete_deploy_key")) return json(null);
      return json({ error: "unexpected" }, 500);
    },
  );
  const { getConvexCanonicalUrls } = await import("./convex-canonical");
  const result = await withSelection(
    { user: "alice", connection: "admin" },
    () => getConvexCanonicalUrls("happy-otter-123", fetchImpl),
  );
  expect(result).toMatchObject({
    convexCloudUrl: "https://happy-otter-123.convex.cloud",
    convexSiteUrl: "https://happy-otter-123.convex.site",
  });
  expect(seen.at(-1)).toMatch(/delete_deploy_key$/);
  expect(JSON.stringify(result)).not.toContain(DEPLOY_KEY);
});
it("sets canonical Cloud only after the matching custom domain is verified", async () => {
  const withSelection = await seeded();
  let canonical = {
    convexCloudUrl: "https://happy-otter-123.convex.cloud",
    convexSiteUrl: "https://happy-otter-123.convex.site",
  };
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/custom_domains"))
        return json({
          domains: [
            {
              domain: "api.example.com",
              deploymentName: "happy-otter-123",
              requestDestination: "convexCloud",
              creationTime: 1,
              verificationTime: 2,
            },
          ],
        });
      if (url.endsWith("/create_deploy_key"))
        return json({ deployKey: DEPLOY_KEY });
      if (url.endsWith("/update_canonical_url")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          requestDestination: "convexCloud",
          url: "https://api.example.com",
        });
        canonical = { ...canonical, convexCloudUrl: "https://api.example.com" };
        return json(null);
      }
      if (url.endsWith("/get_canonical_urls")) return json(canonical);
      if (url.endsWith("/delete_deploy_key")) return json(null);
      return json({ error: "unexpected" }, 500);
    },
  );
  const { setConvexCanonicalUrl } = await import("./convex-canonical");
  const result = await withSelection(
    { user: "alice", connection: "admin" },
    () =>
      setConvexCanonicalUrl(
        {
          deploymentName: "happy-otter-123",
          requestDestination: "convexCloud",
          url: "https://api.example.com",
        },
        fetchImpl,
      ),
  );
  expect(result.canonical.convexCloudUrl).toBe("https://api.example.com");
});
it("deletes the ephemeral key even when the deployment API fails", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/create_deploy_key"))
      return json({ deployKey: DEPLOY_KEY });
    if (url.endsWith("/get_canonical_urls"))
      return json({ error: "boom" }, 500);
    if (url.endsWith("/delete_deploy_key")) {
      deleted = true;
      return json(null);
    }
    return json({ error: "unexpected" }, 500);
  });
  const { getConvexCanonicalUrls } = await import("./convex-canonical");
  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      getConvexCanonicalUrls("happy-otter-123", fetchImpl),
    ),
  ).rejects.toMatchObject({ code: "convex_deployment_http_500" });
  expect(deleted).toBe(true);
});

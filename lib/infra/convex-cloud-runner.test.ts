import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
const PAT = "pat_synthetic_12345678901234567890";
const DEPLOY_KEY =
  "prod:happy-otter-123|synthetic_deploy_key_1234567890abcdef";
let root: string;
let project: string;
let snapshot: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-runner-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  process.env.OS_FS_READ_ROOTS = root;
  process.env.OS_FS_WRITE_ROOTS = root;
  project = path.join(root, "project");
  snapshot = path.join(root, "merged.zip");
  await fs.mkdir(path.join(project, "convex"), { recursive: true });
  await fs.mkdir(path.join(project, "node_modules", ".bin"), { recursive: true });
  await fs.writeFile(
    path.join(project, "node_modules", ".bin", "convex"),
    "#!/bin/sh\nexit 0\n",
    { mode: 0o755 },
  );
  // ZIP empty-archive signature; the runner validates the archive magic before import.
  await fs.writeFile(
    snapshot,
    Buffer.from([
      0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0,
    ]),
    { mode: 0o600 },
  );
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  delete process.env.OS_FS_READ_ROOTS;
  delete process.env.OS_FS_WRITE_ROOTS;
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
  const { withIntegrationSelection } = await import("./connection-service");
  const { setInfraProvider } = await import("./store");
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
it("deploys with an ephemeral deploy-only key and always revokes it", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/create_deploy_key")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          allowedActions: ["deployment:deploy"],
        });
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${PAT}`,
        );
        return json({ deployKey: DEPLOY_KEY });
      }
      if (url.endsWith("/delete_deploy_key")) {
        deleted = true;
        return json({});
      }
      return json({ error: "unexpected" }, 500);
    },
  );
  const runCli = vi.fn(async (_exe, args, options) => {
    expect(args).toEqual(["deploy", "--yes"]);
    expect(options.cwd).toBe(project);
    expect(options.env.CONVEX_DEPLOY_KEY).toBe(DEPLOY_KEY);
    expect(options.env.CONVEX_SELF_HOSTED_URL).toBeUndefined();
    return { code: 0, stdout: "deployed", stderr: "", durationMs: 12 };
  });
  const { deployConvexCloudProject } = await import("./convex-cloud-runner");
  const result = await withSelection(
    { user: "alice", connection: "admin" },
    () =>
      deployConvexCloudProject(
        { deploymentName: "happy-otter-123", projectPath: project },
        { fetchImpl, runCli },
      ),
  );
  expect(result).toMatchObject({
    deploymentName: "happy-otter-123",
    projectPath: project,
    deployed: true,
  });
  expect(deleted).toBe(true);
  expect(JSON.stringify(result)).not.toContain(DEPLOY_KEY);
  expect(JSON.stringify(result)).not.toContain(PAT);
});
it("imports only with explicit mode and a data-scoped ephemeral key", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const fetchImpl = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/create_deploy_key")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          allowedActions: ["deployment:data:view", "deployment:data:write"],
        });
        return json({ deployKey: DEPLOY_KEY });
      }
      if (url.endsWith("/delete_deploy_key")) {
        deleted = true;
        return json({});
      }
      return json({ error: "unexpected" }, 500);
    },
  );
  const runCli = vi.fn(async (_exe, args, options) => {
    expect(args).toEqual(["import", snapshot, "--replace-all", "--yes"]);
    expect(options.env.CONVEX_DEPLOY_KEY).toBe(DEPLOY_KEY);
    return { code: 0, stdout: "imported", stderr: "", durationMs: 21 };
  });
  const { importConvexCloudSnapshot } = await import("./convex-cloud-runner");
  const result = await withSelection(
    { user: "alice", connection: "admin" },
    () =>
      importConvexCloudSnapshot(
        {
          deploymentName: "happy-otter-123",
          projectPath: project,
          snapshotPath: snapshot,
          mode: "replace-all",
        },
        { fetchImpl, runCli },
      ),
  );
  expect(result.imported).toBe(true);
  expect(result.mode).toBe("replace-all");
  expect(result.snapshot.bytes).toBe(22);
  expect(result.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(deleted).toBe(true);
  expect(JSON.stringify(result)).not.toContain(DEPLOY_KEY);
});
it("revokes the ephemeral key when the CLI operation fails", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/create_deploy_key"))
      return json({ deployKey: DEPLOY_KEY });
    if (url.endsWith("/delete_deploy_key")) {
      deleted = true;
      return json({});
    }
    return json({ error: "unexpected" }, 500);
  });
  const runCli = vi.fn(async () => ({
    code: 1,
    stdout: "",
    stderr: `failure ${DEPLOY_KEY}`,
    durationMs: 5,
  }));
  const { deployConvexCloudProject } = await import("./convex-cloud-runner");
  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      deployConvexCloudProject(
        { deploymentName: "happy-otter-123", projectPath: project },
        { fetchImpl, runCli },
      ),
    ),
  ).rejects.toMatchObject({ code: "convex_cloud_deploy_failed" });
  expect(deleted).toBe(true);
});
it("rejects non-zip snapshots before minting a write key", async () => {
  const withSelection = await seeded();
  const bad = path.join(root, "not-a-zip.txt");
  await fs.writeFile(bad, "not zip");
  const fetchImpl = vi.fn();
  const { importConvexCloudSnapshot } = await import("./convex-cloud-runner");
  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      importConvexCloudSnapshot(
        {
          deploymentName: "happy-otter-123",
          projectPath: project,
          snapshotPath: bad,
          mode: "replace-all",
        },
        { fetchImpl },
      ),
    ),
  ).rejects.toMatchObject({ code: "convex_snapshot_zip_required" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

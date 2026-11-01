import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const PAT = "pat_synthetic_12345678901234567890", KEY = "prod:happy-otter-123|synthetic_deploy_key_1234567890";
let root: string, project: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-env-set-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  process.env.OS_FS_READ_ROOTS = root;
  process.env.OS_FS_WRITE_ROOTS = root;
  project = path.join(root, "project");
  await fs.mkdir(path.join(project, "convex"), { recursive: true });
  await fs.mkdir(path.join(project, "node_modules", ".bin"), { recursive: true });
  await fs.writeFile(path.join(project, "node_modules", ".bin", "convex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  delete process.env.OS_FS_READ_ROOTS;
  delete process.env.OS_FS_WRITE_ROOTS;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});

async function seeded(connectionValues: Record<string, string> = { personalToken: PAT }) {
  const { integrationManage } = await import("./connection-manage");
  await integrationManage({ action: "user.create", user: "alice", confirm: true });
  await integrationManage({ action: "connection.create", user: "alice", provider: "convex-cloud", connection: "admin", authMethod: "personal", source: "direct", confirm: true });
  const { withIntegrationSelection } = await import("./connection-service");
  const { setInfraProvider } = await import("./store");
  await withIntegrationSelection({ user: "alice", connection: "admin" }, () => setInfraProvider("convex-cloud", connectionValues));
  return withIntegrationSelection;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

it("successfully sets env variable and always revokes the deploy key", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const SECRET_VAL = "super-secret-client-id-xyz";
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/create_deploy_key")) {
      expect(JSON.parse(String(init?.body))).toMatchObject({ allowedActions: ["deployment:env:view", "deployment:env:write"] });
      return json({ deployKey: KEY });
    }
    if (url.endsWith("/delete_deploy_key")) { deleted = true; return json({}); }
    return json({ error: "unexpected" }, 500);
  });
  let secretFilePath = "";
  const runCli = vi.fn(async (_exe, args, options) => {
    // The value must never be an argv element: /proc/<pid>/cmdline is world-readable while the CLI
    // runs. It travels in a 0600 file via --from-file, and that file is removed afterwards.
    expect(args).toEqual(["env", "set", "--from-file", expect.stringMatching(/mso-convex-env-/)]);
    expect(args.join(" ")).not.toContain(SECRET_VAL);
    secretFilePath = args[3];
    const onDisk = await fs.readFile(secretFilePath, "utf8");
    expect(onDisk).toBe(`AUTH_GOOGLE_ID=${SECRET_VAL}\n`);
    const mode = (await fs.stat(secretFilePath)).mode & 0o777;
    expect(mode, "the temp file must not be readable by other users").toBe(0o600);
    expect(options.env.CONVEX_DEPLOY_KEY).toBe(KEY);
    return { code: 0, stdout: "successfully set AUTH_GOOGLE_ID", stderr: "", durationMs: 10 };
  });

  const { setConvexEnv } = await import("./convex-env-set");
  const result = await withSelection({ user: "alice", connection: "admin" }, () =>
    setConvexEnv({ deploymentName: "happy-otter-123", name: "AUTH_GOOGLE_ID", value: SECRET_VAL, projectPath: project }, { fetchImpl, runCli })
  );
  expect(result).toEqual({ deploymentName: "happy-otter-123", name: "AUTH_GOOGLE_ID", set: true });
  expect(deleted).toBe(true);
  await expect(fs.stat(secretFilePath)).rejects.toMatchObject({ code: "ENOENT" });
  expect(JSON.stringify(result)).not.toContain(SECRET_VAL);
  expect(JSON.stringify(result)).not.toContain(KEY);
});

it("always revokes deploy key even when writing fails and redacts value from error", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const SECRET_VAL = "leaked-secret-value-123";
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/create_deploy_key")) return json({ deployKey: KEY });
    if (url.endsWith("/delete_deploy_key")) { deleted = true; return json({}); }
    return json({ error: "unexpected" }, 500);
  });
  const runCli = vi.fn(async () => ({ code: 1, stdout: "", stderr: `failed to set variable with ${SECRET_VAL}`, durationMs: 10 }));

  const { setConvexEnv } = await import("./convex-env-set");
  let caught: unknown;
  try {
    await withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ deploymentName: "happy-otter-123", name: "AUTH_GOOGLE_ID", value: SECRET_VAL, projectPath: project }, { fetchImpl, runCli })
    );
  } catch (error) { caught = error; }

  expect(deleted).toBe(true);
  expect(caught).toBeDefined();
  expect((caught as { code: string }).code).toBe("convex_cloud_env_set_failed");
  expect(JSON.stringify(caught)).not.toContain(SECRET_VAL);
  expect(JSON.stringify(caught)).not.toContain(KEY);
});

it("redacts secret value when child process throws an unexpected error", async () => {
  const withSelection = await seeded();
  let deleted = false;
  const SECRET_VAL = "unhandled-secret-content";
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/create_deploy_key")) return json({ deployKey: KEY });
    if (url.endsWith("/delete_deploy_key")) { deleted = true; return json({}); }
    return json({ error: "unexpected" }, 500);
  });
  const runCli = vi.fn(async () => { throw new Error(`crash with ${SECRET_VAL}`); });

  const { setConvexEnv } = await import("./convex-env-set");
  let caught: unknown;
  try {
    await withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ deploymentName: "happy-otter-123", name: "AUTH_GOOGLE_ID", value: SECRET_VAL, projectPath: project }, { fetchImpl, runCli })
    );
  } catch (error) { caught = error; }

  expect(deleted).toBe(true);
  expect(caught).toBeDefined();
  expect((caught as Error).message).not.toContain(SECRET_VAL);
});

it("refuses malformed or invalid env names without calling cloud APIs", async () => {
  const withSelection = await seeded();
  const fetchImpl = vi.fn();
  const { setConvexEnv } = await import("./convex-env-set");

  for (const badName of ["", "BAD-NAME", "123_START_NUM", "has spaces", "a".repeat(129)]) {
    await expect(
      withSelection({ user: "alice", connection: "admin" }, () =>
        setConvexEnv({ deploymentName: "happy-otter-123", name: badName, value: "valid-value", projectPath: project }, { fetchImpl })
      )
    ).rejects.toMatchObject({ code: "invalid_convex_env_name" });
  }
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("refuses values larger than 8KiB without calling cloud APIs", async () => {
  const withSelection = await seeded();
  const fetchImpl = vi.fn();
  const { setConvexEnv } = await import("./convex-env-set");
  const tooLarge = "x".repeat(8 * 1024 + 1);

  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ deploymentName: "happy-otter-123", name: "VALID_NAME", value: tooLarge, projectPath: project }, { fetchImpl })
    )
  ).rejects.toMatchObject({ code: "convex_env_value_too_large" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("refuses when deploymentName is missing from input and connection", async () => {
  const withSelection = await seeded();
  const fetchImpl = vi.fn();
  const { setConvexEnv } = await import("./convex-env-set");

  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ deploymentName: "", name: "VALID_NAME", value: "test-val", projectPath: project }, { fetchImpl })
    )
  ).rejects.toMatchObject({ code: "convex_deployment_name_required", status: 409 });

  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ deploymentName: "   ", name: "VALID_NAME", value: "test-val", projectPath: project }, { fetchImpl })
    )
  ).rejects.toMatchObject({ code: "convex_deployment_name_required", status: 409 });

  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ name: "VALID_NAME", value: "test-val", projectPath: project }, { fetchImpl })
    )
  ).rejects.toMatchObject({ code: "convex_deployment_name_required", status: 409 });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("refuses malformed deploymentName with invalid_convex_deployment_name", async () => {
  const withSelection = await seeded();
  const fetchImpl = vi.fn();
  const { setConvexEnv } = await import("./convex-env-set");

  await expect(
    withSelection({ user: "alice", connection: "admin" }, () =>
      setConvexEnv({ deploymentName: "-invalid-start", name: "VALID_NAME", value: "test-val", projectPath: project }, { fetchImpl })
    )
  ).rejects.toMatchObject({ code: "invalid_convex_deployment_name" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

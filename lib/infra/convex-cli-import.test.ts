import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const PAT = "pat_synthetic_12345678901234567890";
let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-convex-cli-"));
  process.env.OS_INFRA_STORE = path.join(root, "infra.json");
  vi.resetModules();
});
afterEach(async () => {
  delete process.env.OS_INFRA_STORE;
  await fs.rm(root, { recursive: true, force: true });
  vi.resetModules();
});
async function createPersonalConnection() {
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
}
it("imports the local CLI token privately and hardens its permissions", async () => {
  await createPersonalConnection();
  const cliDir = path.join(root, "convex"),
    configPath = path.join(cliDir, "config.json");
  await fs.mkdir(cliDir, { mode: 0o775 });
  await fs.writeFile(configPath, JSON.stringify({ accessToken: PAT }), {
    mode: 0o664,
  });
  const { importConvexCliPersonalConnection } =
    await import("./convex-cli-import");
  const result = await importConvexCliPersonalConnection(
    { user: "alice", connection: "admin" },
    {
      configPath,
      doctor: async (id, values) => {
        expect(id).toBe("convex-cloud");
        expect(values.personalToken).toBe(PAT);
        return "personal access token authenticated";
      },
    },
  );
  expect((await fs.stat(cliDir)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(result)).not.toContain(PAT);
  const { directConnectionValues } = await import("./connection-service");
  expect(
    (
      await directConnectionValues("convex-cloud", {
        user: "alice",
        connection: "admin",
      })
    ).personalToken,
  ).toBe(PAT);
});
it("refuses a symlinked CLI credential file", async () => {
  const cliDir = path.join(root, "convex"),
    target = path.join(root, "target.json"),
    configPath = path.join(cliDir, "config.json");
  await fs.mkdir(cliDir, { mode: 0o700 });
  await fs.writeFile(target, JSON.stringify({ accessToken: PAT }), {
    mode: 0o600,
  });
  await fs.symlink(target, configPath);
  const { readConvexCliAccessToken } = await import("./convex-cli-import");
  await expect(readConvexCliAccessToken(configPath)).rejects.toMatchObject({
    code: "unsafe_convex_cli_config",
  });
});

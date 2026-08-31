import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "mso-ship-handoff-"));
const bin = path.join(temp, "bin");
const repo = path.join(temp, "repo");
const capture = path.join(temp, "systemd-run.args");
const script = path.join(process.cwd(), "scripts", "ship-handoff.sh");
let sha = "";

beforeAll(async () => {
  await fs.mkdir(path.join(repo, "scripts"), { recursive: true });
  await fs.writeFile(path.join(repo, "scripts", "mso-service-update"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await run("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await run("git", ["config", "user.name", "MSO Test"], { cwd: repo });
  await run("git", ["config", "user.email", "mso-test@example.invalid"], { cwd: repo });
  await run("git", ["add", "."], { cwd: repo });
  await run("git", ["commit", "-q", "-m", "test fixture"], { cwd: repo });
  sha = (await run("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
  await run("git", ["update-ref", "refs/remotes/origin/main", sha], { cwd: repo });
});

beforeEach(async () => {
  await fs.rm(bin, { recursive: true, force: true });
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "systemctl"), `#!/bin/sh\nif [ "$2" = "is-active" ]; then exit "\${MSO_TEST_ACTIVE:-3}"; fi\nexit 0\n`, { mode: 0o755 });
  await fs.writeFile(path.join(bin, "systemd-run"), `#!/bin/sh\nprintf '%s\\n' "$@" > "$MSO_TEST_CAPTURE"\n`, { mode: 0o755 });
  await run("git", ["reset", "--hard", "-q", "HEAD"], { cwd: repo });
  await run("git", ["clean", "-fdq"], { cwd: repo });
});

afterAll(async () => { await fs.rm(temp, { recursive: true, force: true }); });

const env = (home: string, extra: Record<string, string> = {}) => ({
  ...process.env,
  HOME: home,
  PATH: `${bin}:/usr/bin:/bin`,
  MSO_TEST_CAPTURE: capture,
  ...extra,
});

describe("MCP ship handoff", () => {
  it("starts the exact verified SHA in the owner user manager with no shell payload", async () => {
    const home = path.join(temp, "home");
    await fs.mkdir(home, { recursive: true });
    const { stdout } = await run("/bin/bash", [script, repo, sha], { env: env(home) });
    const args = (await fs.readFile(capture, "utf8")).trim().split("\n");
    const log = path.join(home, ".mso", "self-update.log");
    expect(args).toEqual([
      "--user",
      "--collect",
      "--unit=mso-self-update",
      `--property=WorkingDirectory=${repo}`,
      "--property=TimeoutStartSec=3600",
      `--setenv=MSO_UPDATE_LOG=${log}`,
      `--setenv=MSO_EXPECTED_SHA=${sha}`,
      "/bin/bash",
      path.join(repo, "scripts", "mso-service-update"),
      "--ship-finalize",
    ]);
    expect(stdout).toContain(`release_sha=${sha}`);
    expect(stdout).toContain("release_unit=mso-self-update.service");
    expect(stdout).toContain(`release_log=${log}`);
  });

  it("refuses an invalid path, SHA, dirty checkout, or active finalizer", async () => {
    await expect(run("/bin/bash", [script, temp, sha], { env: env(temp) })).rejects.toMatchObject({ code: 2 });
    await expect(run("/bin/bash", [script, repo, "bad"], { env: env(temp) })).rejects.toMatchObject({ code: 2 });
    await fs.writeFile(path.join(repo, "dirty.txt"), "dirty");
    await expect(run("/bin/bash", [script, repo, sha], { env: env(temp) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("uncommitted bytes") });
    await fs.rm(path.join(repo, "dirty.txt"));
    await expect(run("/bin/bash", [script, repo, sha], { env: env(temp, { MSO_TEST_ACTIVE: "0" }) }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("already active") });
  });
});

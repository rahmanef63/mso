import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-domain-cli-")); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
function run(...args: string[]) {
  return spawnSync("bun", ["--no-env-file", "--conditions=react-server", "scripts/mso-domain.ts", ...args], {
    encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OS_MANAGED_DOMAINS_STORE: path.join(directory, "domains.json") },
  });
}
it("shows unconfigured status through the actual local Bun entrypoint", async () => {
  const result = run("status");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ version: 1, config: null, apps: {}, desired: {} });
  expect(await fs.stat(path.join(directory, "domains.json")).catch(() => null)).toBeNull();
});
it("rejects incomplete/unknown/credential arguments before any setup write", async () => {
  for (const args of [["setup", "--origin", "https://mso.example.com"], ["setup", "--api-token", "example-value"], ["status", "--apply"], ["status", "9router"], ["ensure", "other"], ["doctor", "9router", "--apply"]]) {
    const result = run(...args);
    expect(result.status, args.join(" ")).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("example-value");
  }
  expect(await fs.stat(path.join(directory, "domains.json")).catch(() => null)).toBeNull();
});
it("loads the shared domain CLI graph without the Next-only server-only marker", () => {
  // The Orca bridge is server-only; the shared health module must reach it lazily
  // so this Bun graph never tries to resolve the Next bundler alias `server-only`.
  for (const args of [["status"], ["help"]]) {
    const result = run(...args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toMatch(/server-only/i);
  }
});
it("prints a usable help contract and returns attention for an unconfigured ensure", () => {
  const help = run("help");
  expect(help.status, help.stderr).toBe(0);
  expect(help.stdout).toContain("mso domain setup");
  expect(help.stdout).toContain("host-only");
  const ensure = run("ensure", "9router", "--apply");
  expect(ensure.status, ensure.stderr).toBe(2);
  expect(JSON.parse(ensure.stdout)).toMatchObject({ configured: false });
});

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appDomainStorePath, isHostname, mutateAppDomainState, parseAppDomainState, readAppDomainState, withAppDomainOperation } from "./app-domain-store";

let directory: string;
const file = () => path.join(directory, "shell-app-domains.json");
const save = () => mutateAppDomainState(next => {
  next.apps.editor = { appId: "editor", hostname: "editor.example.net", phase: "dns-ready", provider: "cloudflare", updatedAt: 1 };
});

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "mso-app-domain-store-"));
  vi.stubEnv("OS_SHELL_APP_DOMAINS_STORE", file());
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

it("starts empty, then writes a 0600 owner file under the owner root", async () => {
  expect(appDomainStorePath()).toBe(file());
  expect(await readAppDomainState()).toEqual({ version: 1, revision: 0, apps: {} });
  await save();
  const state = await readAppDomainState(), stat = await fs.stat(file());
  expect(state).toMatchObject({ version: 1, revision: 1, apps: { editor: { phase: "dns-ready" } } });
  expect(stat.mode & 0o777).toBe(0o600);
  expect(stat.uid).toBe(process.getuid?.());
});

it("refuses group-readable state and a symlinked state file without repairing either", async () => {
  await save();
  await fs.chmod(file(), 0o644);
  await expect(readAppDomainState()).rejects.toThrow(/unsafe/);
  expect((await fs.stat(file())).mode & 0o777).toBe(0o644);
  const target = path.join(directory, "unrelated.txt");
  await fs.writeFile(target, "untouched", { mode: 0o600 });
  await fs.unlink(file());
  await fs.symlink(target, file());
  await expect(readAppDomainState()).rejects.toThrow();
  await expect(save()).rejects.toThrow();
  expect(await fs.readFile(target, "utf8")).toBe("untouched");
});

it("rejects malformed snapshots instead of resetting them", async () => {
  await fs.writeFile(file(), JSON.stringify({ version: 1, revision: 0, apps: { editor: { appId: "other" } } }), { mode: 0o600 });
  await expect(readAppDomainState()).rejects.toThrow(/invalid shell-app domain state/);
  await expect(withAppDomainOperation(save)).rejects.toThrow();
});

it("validates the documented record shape and rejects unknown fields", () => {
  const row = { appId: "editor", hostname: "editor.example.net", phase: "ready", provider: null, updatedAt: 1 };
  expect(parseAppDomainState({ version: 1, revision: 0, apps: { editor: row } }).apps.editor).toEqual(row);
  for (const broken of [{ ...row, phase: "live" }, { ...row, provider: "route53" }, { ...row, hostname: "Editor.example.net" },
    { ...row, error: "x".repeat(513) }, { ...row, credential: "no" }, { ...row, updatedAt: 1.5 }]) {
    expect(() => parseAppDomainState({ version: 1, revision: 0, apps: { editor: broken } })).toThrow();
  }
  expect(isHostname("editor.example.net")).toBe(true);
  for (const bad of ["editor", "editor.example.net.", "203.0.113.10", "", "editor..example.net", "ed itor.example.net"]) expect(isHostname(bad)).toBe(false);
});

it("serializes concurrent operations", async () => {
  let active = 0, peak = 0;
  await Promise.all([1, 2, 3].map(() => withAppDomainOperation(async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
  })));
  expect(peak).toBe(1);
  await expect(withAppDomainOperation(async () => { throw new Error("provider failed"); })).rejects.toThrow("provider failed");
});

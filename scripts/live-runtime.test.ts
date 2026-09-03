import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "scripts/lib/live-runtime.mjs");
const BUILD = path.join(process.cwd(), "scripts/build-safe.sh");
const roots: string[] = [];

function fixture(command: string, options: { sameRoot?: boolean; comm?: string } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mso-live-runtime-")); roots.push(base);
  const root = path.join(base, "repo"), other = path.join(base, "other"), proc = path.join(base, "proc"), pid = path.join(proc, "123");
  fs.mkdirSync(root); fs.mkdirSync(other); fs.mkdirSync(pid, { recursive: true });
  fs.symlinkSync(options.sameRoot === false ? other : root, path.join(pid, "cwd"));
  fs.writeFileSync(path.join(pid, "comm"), `${options.comm ?? "node"}\n`);
  fs.writeFileSync(path.join(pid, "cmdline"), command.replace(/ /g, "\0") + "\0");
  return { base, root, proc };
}

afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("live checkout runtime detector", () => {
  it("detects Next/npm runtimes only when they serve the exact checkout", () => {
    const next = fixture("node node_modules/next/dist/bin/next start --port 4005");
    const found = execFileSync(process.execPath, [SCRIPT, next.root], { env: { ...process.env, MSO_RUNTIME_PROC_ROOT: next.proc }, encoding: "utf8" });
    expect(JSON.parse(found)).toMatchObject({ pid: 123 });

    const other = fixture("npm run start --hostname 0.0.0.0", { sameRoot: false });
    expect(spawnSync(process.execPath, [SCRIPT, other.root], { env: { ...process.env, MSO_RUNTIME_PROC_ROOT: other.proc } }).status).toBe(1);

    const build = fixture("node node_modules/next/dist/bin/next build");
    expect(spawnSync(process.execPath, [SCRIPT, build.root], { env: { ...process.env, MSO_RUNTIME_PROC_ROOT: build.proc } }).status).toBe(1);
  });

  it("recognizes next-server process titles", () => {
    const f = fixture("next-server v16.3.2", { comm: "next-server" });
    expect(spawnSync(process.execPath, [SCRIPT, f.root], { env: { ...process.env, MSO_RUNTIME_PROC_ROOT: f.proc } }).status).toBe(0);
  });

  it("package build is guarded and refuses before touching a fake live checkout", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.scripts.build).toBe("bash scripts/build-safe.sh");

    const proc = fs.mkdtempSync(path.join(os.tmpdir(), "mso-build-proc-")); roots.push(proc);
    const pid = path.join(proc, "456"); fs.mkdirSync(pid);
    fs.symlinkSync(process.cwd(), path.join(pid, "cwd"));
    fs.writeFileSync(path.join(pid, "comm"), "next-server\n"); fs.writeFileSync(path.join(pid, "cmdline"), "next-server\0");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "mso-build-home-")); roots.push(home);
    const out = spawnSync("bash", [BUILD], {
      cwd: process.cwd(), encoding: "utf8",
      env: { ...process.env, HOME: home, MSO_RUNTIME_PROC_ROOT: proc, MSO_RUNTIME_EXCLUSION_DIR: path.join(home, "locks") },
    });
    expect(out.status).toBe(73);
    expect(out.stderr).toContain("refusing in-place Next build");
    expect(out.stderr).toContain("mso deploy");
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { parseMaintenanceArgs } from "./lib/maintenance-plan.mjs";
import { prepareMaintenance, applyMaintenance } from "./lib/maintenance-apply.mjs";
import { inside } from "./lib/maintenance-paths.mjs";

const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mso-maintenance-test-")); fixtures.push(home);
  const repo = path.join(home, "mso");
  const put = (name: string, text = "fixture") => {
    const target = path.join(home, name); fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, text, { mode: 0o600 }); return target;
  };
  put("mso/package.json", '{"name":"mso"}'); put("mso/bin/mso"); put("mso/scripts/install-core.sh");
  const context = { home, repo, env: {}, systemUnitDir: path.join(home, "units"), systemBinDir: path.join(home, "bin") };
  const plan = (...args: string[]) => {
    const options = parseMaintenanceArgs(args); return { options, value: prepareMaintenance(context, options) };
  };
  const apply = (...args: string[]) => {
    const { options, value } = plan(...args);
    return applyMaintenance(context, { ...options, apply: true, confirm: value.confirmation }, value, { assertOffline: () => undefined });
  };
  return { home, repo, context, put, plan, apply };
}

describe("maintenance preview and argument boundary", () => {
  it("does not create state, locks or backups during preview", () => {
    const f = fixture(), { options, value } = f.plan("reset");
    expect(applyMaintenance(f.context, options, value).applied).toBe(false);
    expect(fs.existsSync(path.join(f.home, ".mso"))).toBe(false);
    expect(fs.existsSync(path.join(f.home, ".mso-maintenance.lock"))).toBe(false);
  });
  it.each([["reset", "--yes"], ["reset", "--scope", "everything"], ["reset", "--scope"], ["reset", "--purge"], ["uninstall", "--scope", "all"], ["uninstall", "--service", "../x"], ["reset", "--json", "--json"]])("refuses invalid option set %j", (...args) => {
    expect(() => parseMaintenanceArgs(args)).toThrow();
  });
  it("requires the current preview token", () => {
    const f = fixture(); f.put(".mso/prefs.json"); const { options, value } = f.plan("reset");
    expect(() => applyMaintenance(f.context, { ...options, apply: true, confirm: "wrong" }, value)).toThrow(/confirm/);
    expect(fs.existsSync(path.join(f.home, ".mso/prefs.json"))).toBe(true);
  });
  it("refuses a target replaced after preview", () => {
    const f = fixture(), file = f.put(".mso/prefs.json"); const { options, value } = f.plan("reset");
    fs.renameSync(file, file + ".old"); fs.writeFileSync(file, "replacement", { mode: 0o600 });
    expect(() => applyMaintenance(f.context, { ...options, apply: true, confirm: value.confirmation }, value, { assertOffline: () => undefined })).toThrow(/changed since preview/);
  });
  it("refuses active-runtime application before changing any data", () => {
    const f = fixture(), file = f.put(".mso/prefs.json"); const { options, value } = f.plan("reset");
    expect(() => applyMaintenance(f.context, { ...options, apply: true, confirm: value.confirmation }, value, { assertOffline: () => { throw new Error("runtime active"); } })).toThrow(/runtime active/);
    expect(fs.readFileSync(file, "utf8")).toBe("fixture");
  });
  it("rejects remote targeting and avoids sourcing an env file", () => {
    const f = fixture(); const marker = path.join(f.home, "sourced"); f.put("danger.env", `touch '${marker}'\n`);
    const run = spawnSync("bash", [path.join(process.cwd(), "bin/mso"), "--env", path.join(f.home, "danger.env"), "reset", "--help"], { encoding: "utf8", env: { ...process.env, HOME: f.home } });
    expect(run.status).not.toBe(0); expect(run.stderr).toContain("local-only"); expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(f.home, ".mso"))).toBe(false);
  });
});

describe("maintenance ownership and preservation", () => {
  it("rejects a symlinked state directory", () => {
    const f = fixture(); fs.symlinkSync(f.repo, path.join(f.home, ".mso"));
    expect(f.plan("reset").value.blockers.join(" ")).toMatch(/Unsafe parent/);
  });
  it("rejects a symlinked configuration target", () => {
    const f = fixture(); const external = f.put("other/data"); f.put(".mso/keep");
    fs.symlinkSync(external, path.join(f.home, ".mso/config.json"));
    expect(f.plan("reset").value.blockers.join(" ")).toMatch(/symlink/);
  });
  it("rejects a symlinked launcher parent without touching its destination", () => {
    const f = fixture(); f.put("elsewhere/keep"); fs.mkdirSync(path.join(f.home, ".local"), { mode: 0o700 });
    fs.symlinkSync(path.join(f.home, "elsewhere"), path.join(f.home, ".local/bin"));
    fs.symlinkSync(path.join(f.repo, "bin/mso"), path.join(f.home, "elsewhere/mso"));
    expect(f.plan("uninstall").value.blockers.join(" ")).toMatch(/Unsafe ownership root/);
  });
  it("blocks custom paths without returning secret values", () => {
    const f = fixture(); f.put("mso/.env.local", "OS_CONFIG_STORE=/outside/private-location\nOS_LOGIN_PASSWORD=do-not-print\n");
    const p = f.plan("reset", "--scope", "all").value;
    expect(p.blockers.join(" ")).toContain("OS_CONFIG_STORE");
    expect(JSON.stringify(p)).not.toContain("do-not-print"); expect(JSON.stringify(p)).not.toContain("private-location");
  });
  it("archives config privately while preserving authentication and install configuration", () => {
    const f = fixture(); f.put(".mso/config.json", "model-config"); f.put(".mso/prefs.json"); f.put(".mso/auth-devices.json"); f.put("mso/.env.local", "# fixture\n");
    const result = f.apply("reset"); expect(result.applied).toBe(true);
    expect(fs.existsSync(path.join(f.home, ".mso/config.json"))).toBe(false);
    expect(fs.existsSync(path.join(f.home, ".mso/auth-devices.json"))).toBe(true);
    expect(fs.existsSync(path.join(f.repo, ".env.local"))).toBe(true);
    const backup = result.backup!; expect(fs.statSync(backup).mode & 0o777).toBe(0o700);
    expect(fs.readFileSync(path.join(backup, "files/.mso/config.json"), "utf8")).toBe("model-config");
    expect(fs.statSync(path.join(backup, "manifest.json")).mode & 0o777).toBe(0o600);
  });
  it("full reset archives identity/history but preserves unknown projects and browser profiles", () => {
    const f = fixture(); f.put(".mso/auth-devices.json"); f.put(".mso/threads/one.yaml"); f.put("mso/.env.local", "# fixture\n");
    const saved = f.put(".mso/worktrees/private-project/keep"); const browser = f.put(".local/share/camoufox/keep");
    const result = f.apply("reset", "--scope", "all"); expect(result.applied).toBe(true);
    expect(fs.existsSync(path.join(f.repo, ".env.local"))).toBe(false);
    expect(fs.existsSync(saved)).toBe(true); expect(fs.existsSync(browser)).toBe(true);
  });
  it("normal uninstall only removes links pointing into this installation", () => {
    const f = fixture(); f.put(".mso/config.json"); f.put(".local/bin/other");
    fs.symlinkSync(path.join(f.repo, "bin/mso"), path.join(f.home, ".local/bin/mso"));
    f.put(".claude/skills/other/SKILL.md"); fs.symlinkSync(path.join(f.repo, "claude-skills/mso"), path.join(f.home, ".claude/skills/mso"));
    f.apply("uninstall"); expect(fs.existsSync(path.join(f.home, ".local/bin/mso"))).toBe(false);
    expect(fs.existsSync(path.join(f.home, ".local/bin/other"))).toBe(true);
    expect(fs.existsSync(path.join(f.home, ".mso/config.json"))).toBe(true);
    expect(fs.existsSync(f.repo)).toBe(true);
  });
  it("purge deletes known state and reset archives, not unknown worktrees", () => {
    const f = fixture(); f.put(".mso/config.json"); f.put(".mso/maintenance-backups/test/data"); const kept = f.put(".mso/worktrees/keep");
    f.apply("uninstall", "--purge"); expect(fs.existsSync(path.join(f.home, ".mso/config.json"))).toBe(false);
    expect(fs.existsSync(path.join(f.home, ".mso/maintenance-backups"))).toBe(false); expect(fs.existsSync(kept)).toBe(true);
  });
  it("refuses removing code from a linked or unverified checkout", () => {
    const f = fixture(); f.put("mso/.git", "gitdir: elsewhere");
    expect(f.plan("uninstall", "--purge", "--remove-code").value.blockers.join(" ")).toMatch(/standalone|unverified/);
  });
  it("requires explicit purge when removing source code", () => {
    const f = fixture(); expect(f.plan("uninstall", "--remove-code").value.blockers.join(" ")).toContain("--purge");
  });
  it("does not confuse sibling prefix paths with descendants", () => {
    expect(inside("/home/owner/mso", "/home/owner/mso-backup")).toBe(false);
    expect(inside("/home/owner/mso", "/home/owner/mso")).toBe(false);
  });
  it("removes a clean standalone clone only with explicit purge and code options", () => {
    const f = fixture(); f.put("mso/.gitignore", ".env.local\nnode_modules/\n");
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: f.repo, encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    };
    git("init", "-q"); git("add", ".");
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
    f.put("mso/.env.local", "# synthetic config\n"); f.put(".mso/config.json");
    const kept = f.put("other-project/keep");
    const preview = f.plan("uninstall", "--purge", "--remove-code");
    expect(preview.value.blockers).toEqual([]);
    f.apply("uninstall", "--purge", "--remove-code");
    expect(fs.existsSync(f.repo)).toBe(false); expect(fs.existsSync(kept)).toBe(true);
  });
  it("keeps state when verified service removal fails", () => {
    const f = fixture(); const state = f.put(".mso/config.json");
    f.put("units/mso.service", `[Service]\nWorkingDirectory=${f.repo}\n`);
    const { options, value } = f.plan("uninstall", "--purge");
    expect(() => applyMaintenance(f.context, { ...options, apply: true, confirm: value.confirmation }, value, {
      assertOffline: () => undefined, systemAction: () => { throw new Error("service operation refused"); },
    })).toThrow(/service operation refused/);
    expect(fs.existsSync(state)).toBe(true);
  });

});

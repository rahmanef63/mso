import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { confirmationFor, maintenancePlan } from "./maintenance-plan.mjs";
import { ensurePrivateDirectory, inside, revalidate, snapshot, statOrNull } from "./maintenance-paths.mjs";

const run = (command, args) => spawnSync(command, args, { encoding: "utf8", timeout: 15000, maxBuffer: 65536 });
export function prepareMaintenance(context, options) {
  const plan = { ...maintenancePlan(context, options), services: [] };
  for (const [manager, dir] of [["system", context.systemUnitDir ?? "/etc/systemd/system"], ["user", path.join(context.home, ".config/systemd/user")]]) {
    for (const name of [options.service, "camoufox-vnc.service"]) {
      const file = path.join(dir, name), stat = statOrNull(file);
      if (!stat) continue;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) { plan.blockers.push(`Unverified service unit: ${name}`); continue; }
      const text = fs.readFileSync(file, "utf8");
      const workingDir = /^WorkingDirectory=(.*)$/m.exec(text)?.[1];
      const start = /^ExecStart=(.*)$/m.exec(text)?.[1] ?? "";
      const owns = workingDir === context.repo || (name === "camoufox-vnc.service" && start.startsWith(`${context.repo}/scripts/camoufox-vnc-service`));
      if (!owns) { plan.retained.push({ path: file, reason: "Service belongs to another installation" }); continue; }
      try {
        const entry = snapshot(dir, file, { privileged: manager === "system" });
        plan.services.push({ name, manager });
        if (options.action === "uninstall") plan.targets.push({ ...entry, category: "service", name, manager });
      } catch (error) { plan.blockers.push(error.message); }
    }
  }
  return { ...plan, confirmation: confirmationFor(plan) };
}
export function assertOffline(plan) {
  const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
  if (/(?:mso|mso-demo)\.service/.test(cgroup)) throw new Error("Run maintenance from an independent SSH/local terminal, not the MSO service");
  for (const unit of [...plan.services, { name: "mso-self-update.service", manager: "user" }]) {
    const result = run("systemctl", [...(unit.manager === "user" ? ["--user"] : []), "is-active", unit.name]);
    const state = result.stdout?.trim();
    if (["active", "activating", "reloading", "deactivating"].includes(state)) throw new Error(`Stop ${unit.manager} ${unit.name} before applying maintenance`);
    if (plan.services.includes(unit) && !["inactive", "failed", "unknown"].includes(state)) throw new Error(`Cannot verify offline state for ${unit.name}`);
  }
  for (const pid of fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    try {
      const comm = fs.readFileSync(`/proc/${pid}/comm`, "utf8");
      if (!/next-server/.test(comm)) continue;
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      if (JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).name === "mso") throw new Error(`MSO runtime ${pid} is still running; stop it first`);
    } catch (error) { if (error.message.startsWith("MSO runtime")) throw error; }
  }
}
function systemAction(command, args, privileged) {
  const result = privileged && process.getuid() !== 0 ? run("sudo", ["-n", command, ...args]) : run(command, args);
  if (result.status !== 0) throw new Error(`Maintenance system operation failed: ${command}; no success is assumed`);
}
export function applyMaintenance(context, options, plan, dependencies = {}) {
  if (!options.apply) return { applied: false, plan };
  if (process.getuid() === 0) throw new Error("Run as the normal installation owner, not root");
  if (plan.blockers.length) throw new Error(`Resolve preview blockers first: ${plan.blockers.join("; ")}`);
  if (options.confirm !== plan.confirmation) throw new Error("Explicit --confirm must match the current preview token");
  const checkOffline = dependencies.assertOffline ?? assertOffline;
  const privileged = dependencies.systemAction ?? systemAction;
  checkOffline(plan);
  for (const entry of plan.targets) revalidate(entry);
  const lock = path.join(context.home, ".mso-maintenance.lock");
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error("Maintenance lock exists; inspect any interrupted operation before retrying"); }
  let backup = null;
  const completed = [];
  try {
    // Check again under the owner-local lock; never mutate an actively served tree.
    checkOffline(plan);
    if (plan.action === "reset" && plan.targets.length) {
      const base = path.join(context.home, ".mso/maintenance-backups");
      ensurePrivateDirectory(context.home, base);
      backup = path.join(base, randomUUID());
      fs.mkdirSync(backup, { mode: 0o700 });
      fs.writeFileSync(path.join(backup, "manifest.json"), JSON.stringify({ version: 1, createdAt: new Date().toISOString(), plan }, null, 2), { mode: 0o600 });
      for (const entry of plan.targets) {
        revalidate(entry);
        const dest = path.join(backup, "files", path.relative(context.home, entry.path));
        ensurePrivateDirectory(backup, path.dirname(dest));
        fs.renameSync(entry.path, dest);
        completed.push(entry.path);
      }
    } else if (plan.action === "uninstall") {
      // Remove verified service registrations before any code/state. Failure aborts.
      for (const entry of plan.targets.filter((entry) => entry.category === "service")) {
        revalidate(entry);
        privileged("systemctl", [...(entry.manager === "user" ? ["--user"] : []), "disable", entry.name], entry.privileged);
        if (entry.privileged) privileged("rm", ["--", entry.path], true); else fs.unlinkSync(entry.path);
        privileged("systemctl", [...(entry.manager === "user" ? ["--user"] : []), "daemon-reload"], entry.privileged);
        if (statOrNull(entry.path)) throw new Error(`Service unit remains: ${entry.name}`);
        completed.push(entry.path);
      }
      const code = plan.targets.find((entry) => entry.category === "code");
      for (const entry of plan.targets.filter((entry) => entry.category !== "service" && entry.category !== "code")) {
        revalidate(entry);
        if (entry.privileged) privileged("rm", ["--", entry.path], true);
        else fs.rmSync(entry.path, { recursive: entry.kind === "directory", force: false });
        completed.push(entry.path);
      }
      if (code) {
        // Earlier removal of .env.local changes directory mtime, but not identity.
        const now = snapshot(code.root, code.path);
        if (!now || now.dev !== code.dev || now.ino !== code.ino) throw new Error("Installation identity changed");
        if (!inside(context.home, code.path)) throw new Error("Invalid installation target");
        fs.rmSync(code.path, { recursive: true, force: false }); completed.push(code.path);
      }
    }
    return { applied: true, action: plan.action, backup, completed, retained: plan.retained };
  } catch (error) {
    throw new Error(`${error.message}. Completed ${completed.length} step(s).${backup ? ` Recovery files: ${backup}` : ""}`);
  } finally { fs.rmdirSync(lock); }
}

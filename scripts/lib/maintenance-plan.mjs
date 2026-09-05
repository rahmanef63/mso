import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { inside, ownedLink, snapshot, statOrNull } from "./maintenance-paths.mjs";

export const CONFIG_ENTRIES = ["prefs.json", "config.json", "private/infra-providers.json"];
export const ALL_ENTRIES = [...CONFIG_ENTRIES, "auth-devices.json", "mcp.json", "cli.device.id", "memory.json",
  "agent-memory", "agent-sessions", "agent-session-archive", "project-agent-tasks", "threads", "skill-memory.json",
  "audit.log", "temp-shares", "private/cli", "private/gateway", "private/update-state", "private/a2a-inbound-tokens.json",
  "private/a2a-credentials.json", "private/a2a-local-auth.json", "private/a2a-agents.json", "private/a2a-tasks.json",
  "private/local-agent-messages.json", "private/local-agent-presence.json"];
const STORE_OVERRIDES = /^(?:OS_.*(?:STORE|DIR|PATH|LOG)|MSO_(?:PRIVATE_STATE_DIR|DEVICE_FILE|JAR|UPDATE_STATE_DIR|GATEWAY_STATE_DIR))$/;
export function parseMaintenanceArgs(args) {
  const options = { action: args[0], scope: "config", purge: false, removeCode: false, apply: false, json: false, confirm: "", service: "mso.service" };
  if (!["reset", "uninstall"].includes(options.action)) throw new Error("Expected reset or uninstall");
  const seen = new Set();
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Repeated option: ${arg}`); seen.add(arg);
    if (["--help", "-h"].includes(arg)) { options.help = true; continue; }
    if (["--apply", "--json", "--purge", "--remove-code"].includes(arg)) {
      options[{ "--apply": "apply", "--json": "json", "--purge": "purge", "--remove-code": "removeCode" }[arg]] = true; continue;
    }
    if (["--scope", "--confirm", "--service"].includes(arg) && args[i + 1] && !args[i + 1].startsWith("--")) {
      options[arg.slice(2)] = args[++i]; continue;
    }
    throw new Error(`Unknown or incomplete option: ${arg}`);
  }
  if (!["config", "all"].includes(options.scope)) throw new Error("Scope must be config or all");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,100}\.service$/.test(options.service)) throw new Error("Invalid systemd service name");
  if (options.action === "reset" && (options.purge || options.removeCode)) throw new Error("Purge/remove-code are uninstall-only");
  if (options.action === "uninstall" && seen.has("--scope")) throw new Error("Uninstall uses --purge, not --scope");
  return options;
}
export function maintenancePlan(context, options) {
  const { home, repo } = context;
  if (!path.isAbsolute(home) || fs.realpathSync(home) !== home || home === path.parse(home).root || fs.statSync(home).uid !== process.getuid()) throw new Error("Invalid canonical home");
  if (!inside(home, repo) || fs.realpathSync(repo) !== repo) throw new Error("Installation must be a real directory beneath home");
  if (JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).name !== "mso"
    || !statOrNull(path.join(repo, "bin/mso")) || !statOrNull(path.join(repo, "scripts/install-core.sh"))) throw new Error("Not an MSO installation");
  const targets = [], retained = [], blockers = [];
  const add = (root, target, kind = "state", config) => {
    try { const entry = snapshot(root, target, config); if (entry) targets.push({ ...entry, category: kind }); }
    catch (error) { blockers.push(error.message); }
  };
  const state = path.join(home, ".mso");
  const selected = options.action === "reset" ? options.scope === "all" ? ALL_ENTRIES : CONFIG_ENTRIES : options.purge ? [...ALL_ENTRIES, "maintenance-backups"] : [];
  for (const relative of selected) add(home, path.join(state, relative));
  const all = options.scope === "all" && options.action === "reset" || options.purge;
  if (all) add(home, path.join(repo, ".env.local"));
  // Custom stores are never guessed, traversed, or silently advertised as reset.
  const envFile = path.join(repo, ".env.local"), envStat = statOrNull(envFile);
  if (envStat?.isSymbolicLink()) blockers.push("Local configuration is a symlink; review it manually");
  if (selected.length && envStat?.isFile()) {
    if (envStat.size > 1024 * 1024) blockers.push("Local configuration is unexpectedly large");
    else for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (match && STORE_OVERRIDES.test(match[1]) && match[2].trim() && !/^(?:""|'')$/.test(match[2].trim())) blockers.push(`Custom storage override ${match[1]} requires manual reconciliation`);
    }
  }
  for (const [key, value] of Object.entries(context.env ?? {})) if (value && STORE_OVERRIDES.test(key) && selected.length) blockers.push(`Inherited storage override ${key} requires manual reconciliation`);
  if (statOrNull(state)?.isDirectory() && !statOrNull(state)?.isSymbolicLink()) {
    const selectedRoots = new Set(selected.map((name) => name.split("/")[0]));
    for (const name of fs.readdirSync(state)) if (!selectedRoots.has(name)) retained.push({ path: path.join(state, name), reason: "Outside the selected reset scope" });
    retained.push({ path: path.join(state, "private"), reason: "Unrecognized private entries are preserved" });
  }
  if (options.action === "uninstall") {
    for (const dir of [path.join(home, ".local/bin"), context.systemBinDir ?? "/usr/local/bin"]) {
      try { const link = ownedLink(dir, path.join(dir, "mso"), repo); if (link) targets.push({ ...link, category: "launcher" }); }
      catch (error) { blockers.push(error.message); }
    }
    const skills = path.join(home, ".claude/skills");
    if (statOrNull(skills)?.isDirectory() && !statOrNull(skills)?.isSymbolicLink()) for (const name of fs.readdirSync(skills)) {
      try { const link = ownedLink(home, path.join(skills, name), path.join(repo, "claude-skills")); if (link) targets.push({ ...link, category: "skill-link" }); }
      catch (error) { blockers.push(error.message); }
    }
  }
  if (options.removeCode) {
    if (!statOrNull(path.join(repo, ".git"))?.isDirectory()) blockers.push("Code removal requires a standalone Git clone, not a linked worktree");
    const git = (args) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
    const dirty = git(["status", "--porcelain", "--untracked-files=all"]), trees = git(["worktree", "list", "--porcelain"]);
    if (dirty.status !== 0 || dirty.stdout.trim()) blockers.push("Code removal refuses a dirty/unverified checkout");
    if (trees.status !== 0 || (trees.stdout.match(/^worktree /gm) ?? []).length !== 1) blockers.push("Code removal refuses shared linked worktrees");
    const ignored = git(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"]);
    if (ignored.status !== 0 || ignored.stdout.split("\n").filter(Boolean).some((name) => !/^(?:node_modules\/|\.next\/|coverage\/|\.env\.local$|tsconfig\.tsbuildinfo$)/.test(name))) blockers.push("Unrecognized ignored files must be preserved before code removal");
    if (!options.purge) blockers.push("--remove-code also requires --purge because the checkout may contain local configuration");
    add(home, repo, "code");
  } else retained.push({ path: repo, reason: "Source code retained; --remove-code is explicit" });
  retained.push({ path: "Other projects, shared runtimes, external providers, DNS/TLS and browser profiles", reason: "Never owned by this uninstall" });
  return { version: 1, action: options.action, scope: options.scope, purge: options.purge, removeCode: options.removeCode,
    service: options.service, repo, home, targets, retained, blockers: [...new Set(blockers)] };
}
export function confirmationFor(plan) {
  return `${plan.action.toUpperCase()}:${createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16)}`;
}

#!/usr/bin/env node
// Deliberately local CLI, not an HTTP/MCP destructive endpoint.
import os from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMaintenanceArgs } from "./lib/maintenance-plan.mjs";
import { prepareMaintenance, applyMaintenance, assertOffline } from "./lib/maintenance-apply.mjs";

const HELP = `MSO maintenance — local installation only

  mso reset [--scope config|all] [--json]
  mso uninstall [--purge] [--remove-code] [--service name.service] [--json]

Every command is PREVIEW ONLY unless --apply and --confirm <preview-token> are both present.

  reset               Archive managed preferences + model/infrastructure configuration.
  reset --scope all   Also archive MSO identities, sessions, history, memory and .env.local.
  uninstall           Remove only this installation's service registrations and CLI/skill links.
  --purge             Permanently delete known MSO state and reset backups; no recovery copy.
  --remove-code       Also remove a clean standalone clone; requires --purge.

Stop MSO and its fallback/gateway runtimes from an independent SSH terminal first.
Apply refuses active/unknown runtimes, unsafe paths, custom storage overrides, and stale tokens.
Unknown files, worktrees, other projects, external apps, shared Node/Bun, DNS/TLS and browser
profiles are never erased. Review retained paths; manual external cleanup can still be needed.
See docs/MAINTENANCE.md for scope, recovery, and full uninstall instructions.
`;
try {
  const options = parseMaintenanceArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(HELP); process.exit(0); }
  const context = { home: os.homedir(), repo: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), env: process.env };
  const plan = prepareMaintenance(context, options);
  if (options.apply && process.env.MSO_MAINTENANCE_LOCKED !== "1") {
    if (plan.blockers.length || options.confirm !== plan.confirmation) throw new Error("Resolve preview blockers and supply the exact current confirmation token first");
    assertOffline(plan);
    const child = spawnSync("bash", [path.join(context.repo, "scripts/maintenance-lock.sh"), ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(child.status ?? 1);
  }
  const result = applyMaintenance(context, options, plan);
  if (!result.applied && plan.blockers.length) process.exitCode = 2;
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else if (!result.applied) {
    console.log(`MSO ${plan.action} · PREVIEW ONLY\nInstallation: ${plan.repo}\nScope: ${plan.action === "reset" ? plan.scope : plan.purge ? "uninstall + purge" : "uninstall, keep data"}\n`);
    for (const entry of plan.targets) console.log(`  ${plan.action === "reset" ? "ARCHIVE" : "REMOVE "}  ${entry.path}`);
    if (!plan.targets.length) console.log("  No matching owned targets.");
    console.log("\nRetained:"); for (const entry of plan.retained) console.log(`  KEEP  ${entry.path}`);
    if (plan.blockers.length) { console.log("\nBlocked:"); for (const reason of plan.blockers) console.log(`  ${reason}`); }
    else console.log(`\nAfter stopping the runtime, repeat the same options with:\n  --apply --confirm ${plan.confirmation}`);
    console.log("\nNo files, credentials, services or processes were changed.");
    if (plan.blockers.length) process.exitCode = 2;
  } else {
    console.log(`MSO ${plan.action}: completed ${result.completed.length} owned changes.`);
    if (result.backup) console.log(`Private recovery archive: ${result.backup}`);
    console.log("Review retained paths before calling the host fully cleaned.");
  }
} catch (error) { console.error(`mso maintenance: ${error.message}`); process.exitCode = 1; }

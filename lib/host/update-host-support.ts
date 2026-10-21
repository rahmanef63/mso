// Host capability probes the updater needs BOTH from inside Next (the Settings
// panel) and from the nightly timer (scripts/self-update-auto.ts, outside Next).
// No `server-only`, no `@/` alias — same reason as update-facts.ts.
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { updateBranchReason } from "./update-decision";

export const SELF_UPDATE_UNIT = "mso-self-update";
/** The timer-triggered persistent unit. Deliberately NOT `mso-self-update`: that
 *  name belongs to `systemd-run --unit=`, and a unit file with the same name makes
 *  every manual update from Settings fail with "unit already exists". */
export const AUTO_UPDATE_UNIT = "mso-auto-update";

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (command: string, args: readonly string[], timeoutMs?: number, env?: NodeJS.ProcessEnv) => Promise<Ran>;

export const execRunner: Runner = (command, args, timeoutMs = 20_000, env) =>
  new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { cwd: process.cwd(), timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true, shell: false, ...(env ? { env } : {}) },
      (error, stdout, stderr) => {
        const code = typeof (error as { code?: number } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });

export const updateLogPath = (): string => {
  const override = process.env.MSO_UPDATE_LOG?.trim();
  return override || path.join(os.homedir(), ".mso", "self-update.log");
};

export async function readUpdateLog(): Promise<string> {
  const raw = await fs.readFile(/* turbopackIgnore: true */ updateLogPath(), "utf8").catch(() => "");
  // The panel polls this every 3s while a build runs, and the log is the biggest
  // thing in the response.
  return raw.length > 12_000 ? raw.slice(-12_000) : raw;
}

/** True only for an update already in flight. The auto unit itself is not counted:
 *  the nightly pre-flight runs INSIDE it and must not refuse itself.
 *  `offlineProbe` is injected because the setsid PID marker lives in a
 *  `server-only` module the timer cannot import. */
export async function isUpdateRunning(
  run: Runner,
  offlineProbe: () => Promise<boolean>,
): Promise<boolean> {
  const [userUnit, legacySystemUnit] = await Promise.all([
    run("systemctl", ["--user", "is-active", `${SELF_UPDATE_UNIT}.service`], 10_000),
    run("systemctl", ["is-active", `${SELF_UPDATE_UNIT}.service`], 10_000),
  ]);
  if (userUnit.code === 0 || legacySystemUnit.code === 0) return true;
  return offlineProbe();
}

/** Restart authority must never suppress read-only version discovery. */
export async function automaticUpdateReason(run: Runner): Promise<string | null> {
  const branch = await run("git", ["branch", "--show-current"]);
  const branchReason = updateBranchReason(branch.stdout);
  if (branch.code !== 0 || branchReason) {
    return branch.code === 0 ? branchReason : "could not determine the checkout branch";
  }

  // The installer enables linger and gives mso.service XDG_RUNTIME_DIR precisely
  // so the service can reach this per-user manager. Unlike the old sudo path, this
  // is both non-interactive and non-root.
  const userManager = await run("systemctl", ["--user", "show-environment"], 10_000);
  if (userManager.code !== 0) {
    // A container/hosted runtime can legitimately have no systemd at all (PID 1
    // may be tini). The CLI already has a safe offline update path that quiesces
    // only MSO-owned runtimes under the checkout exclusion lock. `setsid -f` is
    // the missing handoff boundary: it lets that path survive the Next process it
    // intentionally stops and replaces. No sudo and no arbitrary client argv.
    const setsid = process.platform === "linux" ? await run("setsid", ["--version"], 5_000) : { code: 1, stdout: "", stderr: "" };
    if (setsid.code === 0) return null;
    return "Automatic restart is unavailable on this host. Run mso update from a terminal; version checks still work.";
  }

  const [loadState, serviceUser, restartPolicy] = await Promise.all([
    run("systemctl", ["show", "-p", "LoadState", "--value", "mso.service"], 10_000),
    run("systemctl", ["show", "-p", "User", "--value", "mso.service"], 10_000),
    run("systemctl", ["show", "-p", "Restart", "--value", "mso.service"], 10_000),
  ]);
  if (loadState.code !== 0 || loadState.stdout.trim() !== "loaded") {
    return "mso.service is not installed; run mso update from a terminal for this host.";
  }
  if (restartPolicy.code !== 0 || restartPolicy.stdout.trim() === "no") {
    return "mso.service has no automatic restart policy; refusing to stop the running process during self-update";
  }
  const owner = os.userInfo().username;
  if (serviceUser.code !== 0 || serviceUser.stdout.trim() !== owner) {
    return `mso.service runs as ${serviceUser.stdout.trim() || "an unknown user"}, not ${owner}; refusing a cross-user update`;
  }

  return null;
}

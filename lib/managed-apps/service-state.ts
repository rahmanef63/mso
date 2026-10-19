import "server-only";
import { runDocker } from "./docker";
import { orcaRunState, type ManagedInstallation } from "./orca-installation";
import { runProgram } from "./runner";
import { userBusEnv } from "./user-bus";

/**
 * Service/container run-state detection for managed apps.
 *
 * `is-active` cannot tell "this unit is stopped" from "this unit does not
 * exist", so `show -p LoadState` distinguishes absent units from installed
 * stopped ones. An owned Orca unit is additionally tri-valued: systemd not
 * answering is `unknown`, never `stopped`.
 */
export async function systemdState(service: string, strict = false): Promise<"active" | "inactive" | "missing"> {
  let present = false;
  for (const scope of [["--user"], []]) {
    // The user scope needs a bus address. mso.service is a SYSTEM unit with
    // `User=`, which inherits no login session and therefore no
    // XDG_RUNTIME_DIR, so without this every `--user` probe below answered
    // "Failed to connect to bus: No medium found" and the whole scope was
    // silently skipped — the app then looked absent no matter what was running.
    const env = scope.length ? userBusEnv() : undefined;
    const result = await runProgram("systemctl", [...scope, "show", "-p", "LoadState", "-p", "ActiveState", service], 10_000, env);
    // Non-zero here is no systemctl at all, or no user bus — not an answer about
    // the unit, so try the next scope rather than concluding anything.
    if (result.code !== 0) { if (strict) throw new Error("Cannot confirm all managed-app service states"); continue; }
    const load = /LoadState=(\S+)/.exec(result.stdout)?.[1];
    if (!load || load === "not-found") continue;
    present = true;
    if (/ActiveState=(?:active|activating|deactivating|reloading)\b/.test(result.stdout)) return "active";
  }
  return present ? "inactive" : "missing";
}

/** `unknown` means systemd gave no definite answer about an owned Orca unit —
 *  never silently equal to "stopped". */
type ManagedRunState = "running" | "stopped" | "unknown";

export async function managedRunState(installation: ManagedInstallation, strict = false): Promise<ManagedRunState> {
  // Owned Orca: user scope only. A system unit of the same name is never ours.
  if (installation.owned && installation.serviceName) {
    const state = await orcaRunState(installation.serviceName);
    if (state !== "unknown") return state;
    // A strict quiescence check must never read "no bus"/"not loaded" as
    // "stopped"; a normal read surfaces it as unknown, not a silent stop.
    if (strict) throw new Error(`Cannot confirm ${installation.serviceName} is stopped: its user-scope systemd state is unknown`);
    return "unknown";
  }
  if (installation.serviceNames && (await Promise.all(installation.serviceNames.map(name => systemdState(name, strict)))).some((state) => state === "active")) return "running";
  for (const containerName of installation.containerNames ?? []) {
    const result = await runDocker(["inspect", "--format", "{{.State.Running}}", containerName], 10_000);
    if (result.code !== 0 || !["true", "false"].includes(result.stdout.trim())) throw new Error("Cannot confirm managed-app container state");
    if (result.stdout.trim() === "true") return "running";
  }
  return "stopped";
}

export async function running(installation: ManagedInstallation, strict = false): Promise<boolean> {
  return (await managedRunState(installation, strict)) === "running";
}

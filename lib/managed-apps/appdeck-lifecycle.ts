import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createBackup, stateDirFor } from "./backups";
import * as manager from "./manager";
import type { ManagedAppDefinition, ManagedAppId } from "./types";
import type { ManagedAppBackup, ManagedAppUpdateOptions } from "./update-types";

/**
 * AppDeck: unified transactional lifecycle engine for external open-source apps.
 *
 * Every managed app (n8n, openclaw, 9router, orca, t3, hermes, and any future
 * external OSS app) runs through the same safety pipeline:
 *   1. Quiesce: pause the app automatically if it is running (never fail on a
 *      running app when the user clicks Update, Uninstall, or Rollback).
 *   2. Backup: snapshot persistent user data before mutating anything.
 *   3. Apply: execute only a reviewed, digest/checksum-pinned adapter or installer.
 *   4. Recover: if backup/update/uninstall fails after pausing, restart the
 *      previous service automatically so non-tech users are never stranded.
 */

export type AppDeckUpdateMode = "adapter" | "pinned-installer";

export interface AppDeckDriver {
  id: ManagedAppId;
  runtime: "docker" | "user-systemd" | "hybrid";
  updateMode: AppDeckUpdateMode;
  fallbackUninstall: boolean;
}

export const APPDECK_INSTALL_SCRIPT = path.join(process.cwd(), "scripts", "managed-app-install");

export const APPDECK_DRIVERS: Record<ManagedAppId, AppDeckDriver> = {
  n8n: { id: "n8n", runtime: "docker", updateMode: "adapter", fallbackUninstall: false },
  "9router": { id: "9router", runtime: "docker", updateMode: "adapter", fallbackUninstall: false },
  t3: { id: "t3", runtime: "user-systemd", updateMode: "adapter", fallbackUninstall: false },
  orca: { id: "orca", runtime: "user-systemd", updateMode: "adapter", fallbackUninstall: false },
  hermes: { id: "hermes", runtime: "hybrid", updateMode: "pinned-installer", fallbackUninstall: true },
  openclaw: { id: "openclaw", runtime: "user-systemd", updateMode: "pinned-installer", fallbackUninstall: true },
};

const exists = (target: string): Promise<boolean> =>
  fs.lstat(target).then(() => true, () => false);

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error));

export function assertPinnedUpdateOptions(id: ManagedAppId, options: ManagedAppUpdateOptions): void {
  if (options.channel || options.tag || options.branch || options.dryRun || options.noRestart) {
    throw new Error(
      `${id} mutable channel/tag/branch updates are disabled until a reviewed immutable artifact target and digest are committed`,
    );
  }
}

export function pinnedInstallerUpdateArgv(id: ManagedAppId): string[] {
  return [APPDECK_INSTALL_SCRIPT, id, "update", "--yes"];
}

export function pinnedInstallerUninstallArgv(id: ManagedAppId, dryRun: boolean): string[] {
  return [APPDECK_INSTALL_SCRIPT, id, "uninstall", "--yes", ...(dryRun ? ["--dry-run"] : [])];
}

export interface QuiesceState {
  wasRunning: boolean;
}

function readOptionalManagerFn<K extends "stopManagedAppForMaintenance" | "startManagedAppForRecovery">(
  key: K,
): (typeof manager)[K] | undefined {
  try {
    const candidate = manager[key];
    return typeof candidate === "function" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/** Pause a running app safely so pre-update/pre-uninstall/pre-restore snapshots
 *  never fail with "stop all app services" when clicked by a non-tech user. */
export async function quiesceManagedApp(
  definition: ManagedAppDefinition,
  append: (text: string) => void,
): Promise<boolean> {
  const stopFn = readOptionalManagerFn("stopManagedAppForMaintenance");
  if (!stopFn) return false;
  append(`[appdeck] step=quiesce Checking whether ${definition.name} is running\n`);
  const stopped = await stopFn(definition.id);
  if (stopped) {
    append(`[appdeck] step=quiesce Paused ${definition.name} safely before making changes\n`);
  }
  return stopped;
}

/** Restart an app that AppDeck paused if a later step fails or after a restore. */
export async function recoverManagedApp(
  definition: ManagedAppDefinition,
  wasRunning: boolean,
  append: (text: string) => void,
  reason: "failure" | "restore",
): Promise<void> {
  if (!wasRunning) return;
  const startFn = readOptionalManagerFn("startManagedAppForRecovery");
  if (!startFn) return;
  const action = reason === "restore" ? "Restarting" : "Recovering previous";
  append(`[appdeck] step=recover ${action} ${definition.name} service\n`);
  const restarted = await startFn(definition.id);
  append(
    restarted
      ? `[appdeck] step=recover ${definition.name} is back online\n`
      : `[appdeck] step=recover Could not restart ${definition.name} automatically; use Start or Rollback in AppDeck\n`,
  );
}

/** Mandatory AppDeck prepare stage: auto-quiesce -> verified state backup. */
export async function quiesceAndSnapshot(
  definition: ManagedAppDefinition,
  reason: ManagedAppBackup["reason"],
  append: (text: string) => void,
  state: QuiesceState,
): Promise<ManagedAppBackup | null> {
  state.wasRunning = await quiesceManagedApp(definition, append);
  const source = stateDirFor(definition);
  append(`[appdeck] step=backup Creating ${reason} backup of ${source}\n`);
  append(`[mso] ${reason} backup of ${source}\n`);

  if (reason === "pre-uninstall" && !(await exists(source))) {
    append(`[mso] nothing to back up - ${source} does not exist\n`);
    return null;
  }

  let backup: ManagedAppBackup;
  try {
    backup = await createBackup(definition, reason, () => manager.assertManagedAppStopped(definition.id));
  } catch (error) {
    throw new Error(`${reason} backup failed, nothing was run: ${errorMessage(error)}`);
  }

  const mb = backup.bytes === null ? "?" : (backup.bytes / 1024 / 1024).toFixed(1);
  append(`[mso] backup ${backup.id} - ${backup.files ?? "?"} files, ${mb} MB\n`);
  append(`[mso] not in the backup (and not restorable from it): ${backup.skipped.dirNames.join(", ")}\n`);
  return backup;
}

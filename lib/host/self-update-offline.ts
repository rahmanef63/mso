import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * systemd-less hosts still need the updater to outlive the web process it
 * replaces. `setsid -f` creates a detached process group; the wrapper redirects
 * its stdio immediately, then runs the same guarded `mso update` path used from a
 * terminal. The API still exposes only one boolean: normal update vs rebuild.
 */
export function offlineUpdateArgs(root: string, rebuildOnly = false): string[] {
  return [
    "-f",
    "/bin/bash",
    path.join(root, "scripts", "mso-offline-update-job"),
    ...(rebuildOnly ? ["--rebuild-only"] : []),
  ];
}

const offlineUpdatePidPath = (): string => path.join(os.homedir(), ".mso", "self-update.pid");

/** True only for the detached updater process that owns the pid marker. */
export async function offlineUpdateRunning(): Promise<boolean> {
  const pidFile = offlineUpdatePidPath();
  const raw = await fs.readFile(/* turbopackIgnore: true */ pidFile, "utf8").catch(() => "");
  const pid = Number(raw.trim());
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    // Avoid treating a stale pid file as live after PID reuse. This branch is
    // Linux-only because setsid fallback is Linux-only, so /proc is authoritative.
    const cmdline = await fs.readFile(/* turbopackIgnore: true */ `/proc/${pid}/cmdline`, "utf8");
    if (cmdline.includes("mso-offline-update-job")) return true;
  } catch {
    // Exited (or inaccessible) means stale; clean the marker below.
  }
  await fs.unlink(/* turbopackIgnore: true */ pidFile).catch(() => undefined);
  return false;
}

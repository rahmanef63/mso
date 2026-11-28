import type { SoftwareUpdateStatus } from "./host-ops-api.ts";

// A previous terminal marker is not evidence for the current attempt.
export function finishedSoftwareUpdate(status: SoftwareUpdateStatus, initialLog: string): boolean {
  const newLog = status.log.startsWith(initialLog) ? status.log.slice(initialLog.length) : status.log;
  const lastMarker = newLog.match(/(?:^|\n)[^\n]*UPDATE (OK|FAILED)[^\n]*/g)?.at(-1);
  return !status.running && !status.pendingBuild && lastMarker?.includes("UPDATE OK") === true;
}

import "server-only";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import type { ManagedAppId } from "./types";

// THE per-app operation lock — the one manager.ts has always taken around
// start/stop/restart/backup, lifted out of it so the job layer takes the SAME
// lock instead of inventing a second one that cannot see it. Nothing here is
// new behaviour; the only change is who may hold it.
//
// In-memory ON PURPOSE, and that is the correct scope: every operation this
// process holds the lock for — a `systemctl restart`, a backup, a 30-minute
// update — is executed BY this process and dies with it (mso.service is
// KillMode=control-group, Delegate=no; see the jobs.ts header). A lock that
// outlived the process would therefore be a claim about work that is no longer
// running, and would wedge the app until someone deleted a file.
//
// What must survive a restart is the RECORD, not the lock, and that is where
// the durable half lives: job-store.ts reconciles a job whose owner process is
// gone to `interrupted`, and startManagedAppJob() refuses to start while a
// record for the app is still live — which is also what stops a SECOND mso
// process on the same $HOME (a dev server on :3000) from running a concurrent
// update, something no in-process Map could ever notice.

// Stashed on globalThis so a dev-mode HMR module reload does not hand out a
// fresh, empty lock while an operation is still in flight (same reason
// lib/host/pty.ts stashes its sessions).
const g = globalThis as { __osManagedAppLock?: Map<ManagedAppId, string> };
const active = (g.__osManagedAppLock ??= new Map<ManagedAppId, string>());

/** Take the lock. `false` = something else is already running for this app;
 *  the caller must NOT release it in that case. */
export function acquireOperation(id: ManagedAppId, label: string): boolean {
  if (active.has(id)) return false;
  active.set(id, label);
  return true;
}

export function releaseOperation(id: ManagedAppId): void {
  active.delete(id);
}

/** The label the holder passed (an action name or a job kind), else undefined. */
export function activeOperation(id: ManagedAppId): string | undefined {
  return active.get(id);
}


function durableOperationPath(id: ManagedAppId): string {
  return path.join(os.homedir(), ".mso", "managed-app-operations", `${id}.operation`);
}

/** Serialize the cross-process decision to start an app operation. Direct
 * lifecycle calls hold this lease for the operation; background jobs hold it
 * until their durable queued/running record exists, then that record becomes
 * the cross-process claim. */
export async function withManagedAppOperationLease<T>(id: ManagedAppId, fn: () => Promise<T>): Promise<T> {
  try {
    return await withSecurityStoreLock(durableOperationPath(id), fn, { busyTimeoutMs: 250 });
  } catch (error) {
    if (error instanceof Error && /security store is busy/.test(error.message)) {
      throw new Error("another operation is already running");
    }
    throw error;
  }
}

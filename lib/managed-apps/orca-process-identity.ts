import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  parseProcStatStartTicks,
  defaultProcReads,
  readProcessSnapshot,
  readLinuxProcessSnapshot,
  type OrcaProcessSnapshot,
  type OrcaProcessReader,
  type OrcaProcReads,
} from "./orca-process-reader";

export type { OrcaProcessSnapshot, OrcaProcessReader, OrcaProcReads };
export {
  parseProcStatStartTicks,
  defaultProcReads,
  readProcessSnapshot,
  readLinuxProcessSnapshot,
};

export interface OrcaRuntimeReceipt {
  schemaVersion: 1;
  runtimeId: string;
  version: "1.4.230";
  serverPid: number;
  serverStartTicks: string;
  nodeBinary: string;
  serverEntry: string;
  userData: string;
  boundEndpoint: string;
  advertisedEndpoint: string;
  readyAt: string;
}

function absolutePath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") && path.isAbsolute(value) ? value : null;
}

export function parseOrcaRuntimeReceipt(content: string): OrcaRuntimeReceipt | null {
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    data = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (data.schemaVersion !== 1) return null;
  if (typeof data.runtimeId !== "string" || data.runtimeId.length === 0) return null;
  if (data.version !== "1.4.230") return null;
  if (typeof data.serverPid !== "number" || !Number.isInteger(data.serverPid) || data.serverPid <= 1) return null;
  if (typeof data.serverStartTicks !== "string" || !/^\d+$/.test(data.serverStartTicks)) return null;
  const nodeBinary = absolutePath(data.nodeBinary);
  const serverEntry = absolutePath(data.serverEntry);
  const userData = absolutePath(data.userData);
  if (!nodeBinary || !serverEntry || !userData) return null;
  if (typeof data.boundEndpoint !== "string" || typeof data.advertisedEndpoint !== "string") return null;
  if (typeof data.readyAt !== "string" || data.readyAt.length === 0) return null;
  return {
    schemaVersion: 1,
    runtimeId: data.runtimeId,
    version: "1.4.230",
    serverPid: data.serverPid,
    serverStartTicks: data.serverStartTicks,
    nodeBinary,
    serverEntry,
    userData,
    boundEndpoint: data.boundEndpoint,
    advertisedEndpoint: data.advertisedEndpoint,
    readyAt: data.readyAt,
  };
}

function isStrictlyInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Every receipt path must live inside the MSO-managed root: the release slot,
 *  the pinned node runtime, and the profile user-data directory. Nothing may point
 *  at a foreign process, a bare `node` on PATH, or the owner's personal profile. */
export function receiptPathsAreContained(receipt: OrcaRuntimeReceipt, managedRoot: string): boolean {
  if (!isStrictlyInside(managedRoot, receipt.serverEntry)) return false;
  if (!isStrictlyInside(path.join(managedRoot, "releases"), receipt.serverEntry)) return false;
  if (!isStrictlyInside(managedRoot, receipt.nodeBinary)) return false;
  if (path.resolve(receipt.userData) !== path.join(path.resolve(managedRoot), "runtime", "user-data")) return false;
  return true;
}

/** Lexical containment is not enough: a symlink inside `releases/` can still
 *  resolve to a foreign script. Resolve the receipt entry, the launched argv[1],
 *  the node binary, and the profile once, then require the real targets to remain
 *  inside the managed root/release slot and entry/argv to be the same file. */
export async function verifyOrcaCanonicalIdentity(
  receipt: OrcaRuntimeReceipt,
  snapshot: OrcaProcessSnapshot | null,
  managedRoot: string,
): Promise<boolean> {
  if (!snapshot || !receiptPathsAreContained(receipt, managedRoot)) return false;
  const argv1 = snapshot.argv[1];
  if (typeof argv1 !== "string" || !path.isAbsolute(argv1)) return false;
  try {
    const rootReal = await fs.realpath(managedRoot);
    const [entryReal, argvReal, nodeReal, userReal] = await Promise.all([
      fs.realpath(receipt.serverEntry),
      fs.realpath(argv1),
      fs.realpath(receipt.nodeBinary),
      fs.realpath(receipt.userData),
    ]);
    return isStrictlyInside(rootReal, entryReal) &&
      isStrictlyInside(path.join(rootReal, "releases"), entryReal) &&
      entryReal === argvReal &&
      isStrictlyInside(rootReal, nodeReal) &&
      userReal === path.join(rootReal, "runtime", "user-data");
  } catch {
    return false;
  }
}

/** PID, start time, owner UID, executable, and server script must all match. A
 *  reused or foreign PID that merely happens to be alive is refused. */
export function verifyOrcaProcessIdentity(
  receipt: OrcaRuntimeReceipt,
  snapshot: OrcaProcessSnapshot | null,
  managedRoot: string,
): boolean {
  if (!snapshot) return false;
  if (!receiptPathsAreContained(receipt, managedRoot)) return false;
  if (snapshot.pid !== receipt.serverPid) return false;
  if (snapshot.startTicks !== receipt.serverStartTicks) return false;
  if (typeof process.getuid === "function" && snapshot.uid !== process.getuid()) return false;

  const expectedExe = path.resolve(receipt.nodeBinary);
  const actualExe = path.resolve(snapshot.exe.replace(/ \(deleted\)$/, ""));
  if (actualExe !== expectedExe) return false;
  // argv[0] must be the exact node binary. Reject a missing or relative argv[0]
  // BEFORE normalizing: `path.resolve` on an empty/relative value would consult
  // the cwd and make the bundler trace the whole project.
  const argv0 = snapshot.argv[0];
  if (typeof argv0 !== "string" || !path.isAbsolute(argv0)) return false;
  if (path.normalize(argv0) !== expectedExe) return false;
  // The launched shape is `node <serverEntry> --bind ...`; an entry that appears
  // anywhere else in argv is not proof of what this process was started to run.
  const argv1 = snapshot.argv[1];
  if (typeof argv1 !== "string" || !path.isAbsolute(argv1)) return false;
  if (path.resolve(argv1) !== path.resolve(receipt.serverEntry)) return false;
  return true;
}

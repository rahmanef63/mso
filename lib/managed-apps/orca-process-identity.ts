import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Kernel-level proof that the process named in the runtime-identity receipt is the
 * exact owned node process MSO launched — not just "a live PID".
 *
 * Reads only /proc/PID/stat (comm-aware field 22), /proc/PID (owner uid), /proc/PID/exe
 * and /proc/PID/cmdline. Never /proc/PID/environ or credentials. Any read failure
 * (ENOENT, EPERM, hidepid) returns null: no proof ⇒ the bridge stays unavailable.
 */
export interface OrcaProcessSnapshot {
  pid: number;
  /** /proc/PID/stat field 22 — start time in clock ticks; changes on PID reuse. */
  startTicks: string;
  uid: number;
  /** Canonical executable from /proc/PID/exe, `" (deleted)"` suffix stripped. */
  exe: string;
  /** /proc/PID/cmdline split on NUL, empty entries dropped. */
  argv: string[];
}

export type OrcaProcessReader = (pid: number) => Promise<OrcaProcessSnapshot | null>;

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

/** Field 22 (`starttime`) of /proc/PID/stat. `comm` (field 2) is wrapped in
 *  parentheses and may itself contain spaces and `)` — parse from the LAST `)`. */
export function parseProcStatStartTicks(stat: string): string | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const rest = stat.slice(close + 1).trim().split(/\s+/);
  const value = rest[19];
  return value && /^\d+$/.test(value) ? value : null;
}

export const readLinuxProcessSnapshot: OrcaProcessReader = async (pid) => {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    const [stat, dirStat, exeLink, cmdline] = await Promise.all([
      fs.readFile(`/proc/${pid}/stat`, "utf-8"),
      fs.stat(`/proc/${pid}`),
      fs.readlink(`/proc/${pid}/exe`),
      fs.readFile(`/proc/${pid}/cmdline`),
    ]);
    const startTicks = parseProcStatStartTicks(stat);
    if (!startTicks) return null;
    const argv = cmdline.toString("utf-8").split("\0").filter((argument) => argument.length > 0);
    if (argv.length === 0) return null;
    return { pid, startTicks, uid: dirStat.uid, exe: exeLink.replace(/ \(deleted\)$/, ""), argv };
  } catch {
    return null;
  }
};

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
  if (!snapshot.argv.includes(receipt.serverEntry)) return false;
  return true;
}

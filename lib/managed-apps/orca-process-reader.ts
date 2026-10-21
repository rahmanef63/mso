import "server-only";
import { promises as fs } from "node:fs";

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

export interface OrcaProcReads {
  stat: (pid: number) => Promise<string | null>;
  uid: (pid: number) => Promise<number | null>;
  exe: (pid: number) => Promise<string | null>;
  argv: (pid: number) => Promise<string[] | null>;
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

const MAX_PROC_BYTES = 1_048_576;
const MAX_ARGV_ENTRIES = 4096;

async function readBounded(path: string, maxBytes = MAX_PROC_BYTES): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(path, "r");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(65_536);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) return null;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString("utf-8");
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export const defaultProcReads: OrcaProcReads = {
  stat: (pid) => readBounded(`/proc/${pid}/stat`),
  uid: async (pid) => {
    try {
      return (await fs.stat(`/proc/${pid}`)).uid;
    } catch {
      return null;
    }
  },
  exe: async (pid) => {
    try {
      return await fs.readlink(`/proc/${pid}/exe`);
    } catch {
      return null;
    }
  },
  argv: async (pid) => {
    const raw = await readBounded(`/proc/${pid}/cmdline`);
    if (raw === null) return null;
    const argv = raw.split("\0").filter((argument) => argument.length > 0);
    return argv.length === 0 || argv.length > MAX_ARGV_ENTRIES ? null : argv;
  },
};

/** Re-read /proc/PID/stat after the metadata snapshot so a PID reused mid-read can
 *  never produce a composite identity. Injectable only for the reuse regression test. */
export async function readProcessSnapshot(
  pid: number,
  reads: OrcaProcReads = defaultProcReads,
): Promise<OrcaProcessSnapshot | null> {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const stat = await reads.stat(pid).catch(() => null);
  const startTicks = stat ? parseProcStatStartTicks(stat) : null;
  if (!startTicks) return null;
  const [uid, exe, argv] = await Promise.all([
    reads.uid(pid).catch(() => null),
    reads.exe(pid).catch(() => null),
    reads.argv(pid).catch(() => null),
  ]);
  if (uid === null || exe === null || argv === null) return null;
  const confirm = await reads.stat(pid).catch(() => null);
  if (!confirm || parseProcStatStartTicks(confirm) !== startTicks) return null;
  return { pid, startTicks, uid, exe: exe.replace(/ \(deleted\)$/, ""), argv };
}

export const readLinuxProcessSnapshot: OrcaProcessReader = (pid) =>
  readProcessSnapshot(pid, defaultProcReads);

import "server-only";
import { constants, promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/**
 * Bounded, symlink-proof filesystem reads for the MSO-owned Orca unit proof.
 *
 * Both the unit file and the trusted `managed-service.json` receipt are opened
 * through a pinned directory fd with `O_NOFOLLOW`, capped from `fstat` before a
 * single byte is read (the read loop stops at cap+1, so a growing file cannot
 * allocate or return unbounded data), and re-`stat`ed to reject an in-flight
 * replacement. The receipt is 0600 inside the 0700 managed root.
 */

export const ORCA_UNIT_MARKER = "# mso-managed-app: orca";
const UNIT_MAX_BYTES = 32 * 1024;
const CONFIG_MAX_BYTES = 64 * 1024;
const SERVICE_CONFIG = "managed-service.json";
const CONTROL = /[\0\r\n]/;
const LOOPBACK_HOSTS = new Set(["localhost", "::1", "[::1]", "0.0.0.0", "[::]", "::"]);

export type TrustedOrcaConfig = {
  hostNode: string;
  cliScript: string;
  managedRoot: string;
  port: number;
  advertisedEndpoint: string;
};

export type TrustedConfigRead =
  | { state: "ok"; config: TrustedOrcaConfig }
  | { state: "missing" }
  | { state: "stale" }
  | { state: "invalid" };

export function ownerUidMatches(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

/** Read at most `maxBytes`; a file that reaches cap+1 is refused. */
async function readBounded(handle: FileHandle, maxBytes: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const remaining = maxBytes + 1 - total;
    if (remaining <= 0) return null;
    const chunk = Buffer.alloc(Math.min(remaining, 16 * 1024));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > maxBytes) return null;
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks, total);
}

async function readOwnedFile(dir: string, filename: string, maxBytes: number, privateMode: boolean): Promise<string | null> {
  let canonicalDir: string;
  try {
    canonicalDir = await fs.realpath(dir);
  } catch {
    return null;
  }
  if (canonicalDir !== path.resolve(dir)) return null;
  let directory;
  try {
    directory = await fs.open(canonicalDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    const dirStat = await directory.stat();
    if (!dirStat.isDirectory() || !ownerUidMatches(dirStat.uid) || (dirStat.mode & 0o022) !== 0) return null;
    let handle;
    try {
      handle = await fs.open(`/proc/self/fd/${directory.fd}/${filename}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      return null;
    }
    try {
      const before = await handle.stat();
      const modeReject = privateMode ? (before.mode & 0o077) !== 0 : (before.mode & 0o022) !== 0;
      if (!before.isFile() || !ownerUidMatches(before.uid) || modeReject || before.size > maxBytes) return null;
      const buffer = await readBounded(handle, maxBytes);
      if (buffer === null) return null;
      const after = await handle.stat();
      if (after.size !== buffer.length || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.mode !== before.mode) return null;
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } finally {
    await directory.close();
  }
}

export async function readOrcaUnitText(unitPath: string): Promise<string | null> {
  return readOwnedFile(path.dirname(unitPath), path.basename(unitPath), UNIT_MAX_BYTES, false);
}

function isAdvertisedEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "wss:" || url.username || url.password || url.search || url.hash) return false;
  return !LOOPBACK_HOSTS.has(url.hostname) && !/^127\./.test(url.hostname);
}

/** A recorded launcher node is trusted only if it is a real, non-replaceable
 *  executable. Sticky world-writable directories (e.g. `/tmp`) may host a file
 *  this user already owns; a non-sticky writable ancestor may not. */
async function isTrustedHostNode(node: unknown): Promise<boolean> {
  if (typeof node !== "string" || !path.isAbsolute(node) || CONTROL.test(node)) return false;
  let info;
  try {
    info = await fs.lstat(node);
  } catch {
    return false;
  }
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o111) === 0 || (info.mode & 0o022) !== 0) return false;
  if (info.uid !== 0 && !ownerUidMatches(info.uid)) return false;
  let dir = path.dirname(node);
  for (;;) {
    let dirInfo;
    try {
      dirInfo = await fs.lstat(dir);
    } catch {
      return false;
    }
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) return false;
    if ((dirInfo.mode & 0o002) !== 0 && (dirInfo.mode & 0o1000) === 0) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return true;
    dir = parent;
  }
}

/**
 * The trusted installation configuration written by the installer. `hostNode`
 * and `cliScript` are the exact launcher the unit was rendered with; there is
 * deliberately no `release.nodeBinary` fallback (that is the pinned child
 * runtime). A config from an older MSO release without these fields is
 * `stale`, so the consumer can demand a reinstall instead of silently adopting
 * a unit it cannot reproduce.
 */
export async function readTrustedConfig(root: string): Promise<TrustedConfigRead> {
  const text = await readOwnedFile(root, SERVICE_CONFIG, CONFIG_MAX_BYTES, true);
  if (text === null) return { state: "missing" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state: "invalid" };
  }
  if (!raw || typeof raw !== "object") return { state: "invalid" };
  const config = raw as Record<string, unknown>;
  if (config.schemaVersion !== 1 || config.applicationId !== "orca" || config.unitIdentity !== ORCA_UNIT_MARKER) {
    return { state: "invalid" };
  }
  if (config.managedRoot !== root) return { state: "invalid" };
  if (typeof config.hostNode !== "string" || typeof config.cliScript !== "string") return { state: "stale" };
  if (!path.isAbsolute(config.cliScript) || CONTROL.test(config.cliScript)) return { state: "invalid" };
  const port = config.port;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) return { state: "invalid" };
  if (!isAdvertisedEndpoint(config.advertisedEndpoint)) return { state: "invalid" };
  if (!(await isTrustedHostNode(config.hostNode))) return { state: "invalid" };
  return {
    state: "ok",
    config: {
      hostNode: config.hostNode,
      cliScript: config.cliScript,
      managedRoot: root,
      port,
      advertisedEndpoint: config.advertisedEndpoint
    }
  };
}

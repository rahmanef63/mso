import "server-only";
import { promises as fs } from "node:fs";
import { isIP } from "node:net";

/** Bounded Linux procfs reads/parsers for the Orca listener-binding proof. */
const MAX_PROC_BYTES = 1_048_576;
const MAX_FD_ENTRIES = 4096;
const FD_BATCH = 64;
const MAX_LINK_BYTES = 4096;

export interface OrcaListenerCandidate {
  family: "ipv4" | "ipv6";
  address: string;
  port: number;
  inode: string;
}

export interface OrcaListenerBinding {
  family: "ipv4" | "ipv6";
  address: string;
  port: number;
  inode: string;
}

/** `/proc/net/tcp{,6}` are seq files: one read can stop at an internal buffer
 *  boundary. Loop to EOF (with a hard cap) or refuse the whole table as incomplete. */
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

function decodeIpv4(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  return Buffer.from(hex, "hex").reverse().join(".");
}

/** /proc/net/tcp6 stores four little-endian 32-bit words. */
function decodeIpv6(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{32}$/.test(hex)) return null;
  const groups = hex.match(/.{8}/g);
  if (!groups || groups.length !== 4) return null;
  const bytes = groups.flatMap((group) => [...Buffer.from(group, "hex")].reverse());
  const segments: number[] = [];
  for (let index = 0; index < 16; index += 2) segments.push((bytes[index] << 8) | bytes[index + 1]);
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < segments.length; ) {
    if (segments[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < segments.length && segments[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const words = segments.map((segment) => segment.toString(16));
  if (bestLength > 1) {
    return `${words.slice(0, bestStart).join(":")}::${words.slice(bestStart + bestLength).join(":")}`;
  }
  return words.join(":");
}

export function parseProcNetListeners(
  content: string,
  family: "ipv4" | "ipv6",
): OrcaListenerCandidate[] {
  const listeners: OrcaListenerCandidate[] = [];
  for (const line of content.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== "0A") continue;
    const [rawAddress, rawPort] = fields[1].split(":");
    if (!rawAddress || !rawPort) continue;
    const port = Number.parseInt(rawPort, 16);
    if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
    const inode = fields[9];
    if (!/^\d+$/.test(inode)) continue;
    const address = family === "ipv4" ? decodeIpv4(rawAddress) : decodeIpv6(rawAddress);
    if (!address) continue;
    listeners.push({ family, address, port, inode });
  }
  return listeners;
}

export async function readLinuxListeners(
  family: "ipv4" | "ipv6",
): Promise<OrcaListenerCandidate[] | null> {
  const content = await readBounded(family === "ipv4" ? "/proc/net/tcp" : "/proc/net/tcp6");
  return content === null ? null : parseProcNetListeners(content, family);
}

/** Iterate `/proc/PID/fd` with the cap applied while iterating, never after an
 *  unbounded readdir. Any non-ENOENT read failure denies the whole proof. */
export async function readProcessSocketInodes(
  pid: number,
  limit = MAX_FD_ENTRIES,
): Promise<Set<string> | null> {
  const inodes = new Set<string>();
  let directory: Awaited<ReturnType<typeof fs.opendir>>;
  try {
    directory = await fs.opendir(`/proc/${pid}/fd`);
  } catch {
    return null;
  }
  try {
    let batch: string[] = [];
    let processed = 0;
    for await (const entry of directory) {
      processed += 1;
      if (processed > limit) return null;
      batch.push(entry.name);
      if (batch.length < FD_BATCH) continue;
      if (!(await readBatch(pid, batch, inodes))) return null;
      batch = [];
    }
    if (batch.length && !(await readBatch(pid, batch, inodes))) return null;
    return inodes;
  } finally {
    await directory.close().catch(() => {});
  }
}

async function readBatch(pid: number, names: string[], inodes: Set<string>): Promise<boolean> {
  const links = await Promise.all(
    names.map((name) =>
      fs
        .readlink(`/proc/${pid}/fd/${name}`)
        .then((link) => (link.length <= MAX_LINK_BYTES ? link : null))
        // An fd may close between readdir and readlink; the listener-table re-read
        // still has to match. EPERM/hidepid denies the whole proof.
        .catch((error: NodeJS.ErrnoException) => (error?.code === "ENOENT" ? "" : null)),
    ),
  );
  if (links.some((link) => link === null)) return false;
  for (const link of links) {
    const match = /^socket:\[(\d+)\]$/.exec(link!);
    if (match) inodes.add(match[1]);
  }
  return true;
}

/** Literal loopback only: a DNS name such as `localhost` is never resolved here. */
export function numericLoopbackAddress(hostname: string): string | null {
  const host = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (host === "::1") return host;
  return isIP(host) === 4 && host.startsWith("127.") ? host : null;
}

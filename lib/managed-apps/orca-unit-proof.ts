import "server-only";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

/**
 * Deterministic proof that a unit file is the MSO-owned Orca USER unit.
 *
 * A marker (or an `ExecStart` substring) is not ownership: the substring test
 * accepted a foreign executable *ahead of* the CLI, a `sh -c` wrapper that merely
 * mentioned the CLI, and a SECOND `ExecStart` line the first-match lookup never
 * saw. This module parses the generated `ExecStart` back to its exact token
 * sequence — the renderer quotes every argument, so unquoting is unambiguous —
 * and reads the file through a pinned, non-writable directory with `O_NOFOLLOW`.
 *
 * The argv is compared against `renderOrcaServiceUnit` (scripts/orca/systemd-unit.mjs):
 * `node <cli> run --managed-root <root>` followed only by the fixed option pairs,
 * in order, with no token the renderer never emits. `ExecStartPre`/`Post`/a second
 * `ExecStart` are refused outright. Nothing here ever executes the unit.
 */

export const ORCA_UNIT_MARKER = "# mso-managed-app: orca";
const UNIT_MAX_BYTES = 32 * 1024;

/** Reverse of `systemdQuote` in scripts/orca/systemd-unit.mjs. Every generated
 *  token is one double-quoted word; `\"`/`\\`/`$$`/`%%` are the only escapes. */
function parseQuotedArgv(value: string): string[] | null {
  const args: string[] = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] !== '"') return null;
    index += 1;
    let token = "";
    let closed = false;
    while (index < value.length) {
      const ch = value[index];
      if (ch === "\\") {
        const next = value[index + 1];
        if (next !== '"' && next !== "\\") return null;
        token += next;
        index += 2;
      } else if (ch === '"') {
        closed = true;
        index += 1;
        break;
      } else if (ch === "$" || ch === "%") {
        if (value[index + 1] !== ch) return null;
        token += ch;
        index += 2;
      } else {
        token += ch;
        index += 1;
      }
    }
    if (!closed) return null;
    args.push(token);
    if (index === value.length) break;
    if (value[index] !== " ") return null;
    index += 1;
    if (index === value.length) return null;
  }
  return args;
}

/** The renderer emits exactly this argv shape for a root: the canonical node
 *  binary and CLI, the fixed subcommand, `--managed-root <root>`, then the fixed
 *  option pairs. Anything else is a foreign executable, a wrapper, or an extra
 *  token, and is refused. */
export function isOwnedOrcaUnit(text: string, root: string, cliScript: string): boolean {
  if (typeof text !== "string") return false;
  const lines = text.split(/\r?\n/);
  if (lines[0] !== ORCA_UNIT_MARKER) return false;
  // Exactly one ExecStart, and no hook/wrapper directive the renderer never emits.
  if (lines.some((line) => /^\s*Exec/.test(line) && !/^ExecStart=/.test(line))) return false;
  const execLines = lines.filter((line) => /^ExecStart=/.test(line));
  if (execLines.length !== 1) return false;
  const argv = parseQuotedArgv(execLines[0].slice("ExecStart=".length));
  if (!argv) return false;
  const [hostNode, cli, mode, rootFlag, managedRoot] = argv;
  if (!path.isAbsolute(hostNode) || !/^node(js)?$/.test(path.basename(hostNode))) return false;
  if (cli !== cliScript || mode !== "run" || rootFlag !== "--managed-root" || managedRoot !== root) return false;
  let index = 5;
  if (argv[index] === "--port") {
    if (!/^\d{1,5}$/.test(argv[index + 1] ?? "")) return false;
    index += 2;
  }
  if (argv[index] === "--advertised-endpoint") {
    if (!/^wss:\/\/\S+$/.test(argv[index + 1] ?? "")) return false;
    index += 2;
  }
  // Must end on an option-pair boundary (at least `--port`), with no trailing token.
  return index === argv.length && index >= 7;
}

export function ownerUidMatches(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

/**
 * Bounded, symlink-proof read of the unit file. A `realpath` mismatch on the
 * containing directory means a symlinked ancestor; the directory and leaf must be
 * owner-owned and not group/other-writable (a writable unit directory would let
 * another user replace the leaf); the leaf is opened `O_NOFOLLOW` through the
 * pinned directory fd and the cap is enforced from `fstat` before any byte moves.
 * The re-`stat` rejects a file altered (content or mode) mid-read.
 */
export async function readOrcaUnitText(unitPath: string): Promise<string | null> {
  const dir = path.dirname(unitPath);
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
      handle = await fs.open(`/proc/self/fd/${directory.fd}/${path.basename(unitPath)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      return null;
    }
    try {
      const before = await handle.stat();
      if (!before.isFile() || !ownerUidMatches(before.uid) || (before.mode & 0o022) !== 0 || before.size > UNIT_MAX_BYTES) return null;
      const buffer = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) return null;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.mode !== before.mode) return null;
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } finally {
    await directory.close();
  }
}

import "server-only";
import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOrcaManagedRoot } from "./orca-private-fs";
import { runProgram } from "./runner";
import { userBusEnv } from "./user-bus";

/**
 * MSO-owned Orca installation ownership.
 *
 * Orca is installed by MSO as ONE exact USER unit at a fixed path, next to a
 * verified install receipt. The generic manager cannot prove that: `systemctl
 * show` answers for a same-name unit in EITHER scope, so an unrelated system
 * `mso-orca.service` looked "installed" and an Operator stop would signal a unit
 * MSO never created. This module narrows the proof to:
 *   1. the exact USER unit file at `~/.config/systemd/user/mso-orca.service` —
 *      read symlink-proof and bounded (`realpath` ancestor check + `O_NOFOLLOW`
 *      fd read, mirroring `orca-private-fs`), a regular owner-owned file whose
 *      `ExecStart` names this repo's canonical `scripts/orca/cli.mjs` AND the
 *      resolved managed root, and
 *   2. a verified install receipt, read by invoking the adapter's exact
 *      `readInstalledOrcaRelease` contract (`--version`), which rehashes the
 *      immutable release and prints the pinned version.
 * Anything else (foreign unit, wrong root/cli, wrong version, missing/invalid
 * receipt) is `not-installed` + a diagnostic, and mutation/install is refused.
 */

export type ManagedInstallation = {
  type: "systemd" | "docker" | "package" | "not-installed";
  serviceName?: string;
  serviceNames?: string[];
  containerName?: string;
  containerNames?: string[];
  /** True only for MSO's exact owned USER unit (fixed path, marker + argv, no symlink). */
  owned?: boolean;
  /** Operator-facing reason a same-name/partial install was refused. */
  diagnostic?: string | null;
};

export const ORCA_SERVICE = "mso-orca.service";
export const ORCA_UNIT_MARKER = "# mso-managed-app: orca";
/** Mirrors `scripts/orca/constants.mjs` `ORCA_VERSION`; a receipt must match it. */
export const EXPECTED_ORCA_VERSION = "1.4.230";
const INSTALL_RECEIPT = "managed-install.json";
const UNIT_MAX_BYTES = 32 * 1024;
const VERSION_TIMEOUT_MS = 20_000;

export function orcaUserUnitPath(home: string = os.homedir()): string {
  return path.join(home, ".config", "systemd", "user", ORCA_SERVICE);
}

/** This repository's canonical CLI entry point, as `renderOrcaServiceUnit` writes it. */
export function canonicalOrcaCliPath(cwd: string = process.cwd()): string {
  return path.join(cwd, "scripts", "orca", "cli.mjs");
}

/** Mirrors `systemdQuote` in scripts/orca/systemd-unit.mjs (no mjs import from TS). */
function systemdQuote(value: string): string {
  const escaped = value
    .replace(/%/g, "%%")
    .replace(/\$/g, () => "$$")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Exact generated ownership: the marker, plus an `ExecStart` that names this
 * repo's canonical CLI and the RESOLVED managed root. A marker alone would accept
 * a unit pointed at a foreign CLI or another root.
 */
export function isOwnedOrcaUnit(text: string, root: string, cliScript: string = canonicalOrcaCliPath()): boolean {
  const lines = text.split(/\r?\n/);
  if (!lines.includes(ORCA_UNIT_MARKER)) return false;
  const exec = lines.find((line) => line.startsWith("ExecStart="));
  if (!exec) return false;
  return exec.includes(systemdQuote(cliScript)) && exec.includes(systemdQuote(root)) && exec.includes("--managed-root");
}

function uidMatches(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

/**
 * Bounded, symlink-proof read of the unit file. A `realpath` mismatch on the
 * containing directory means a symlinked ancestor; the leaf is opened
 * `O_NOFOLLOW` through the pinned directory fd and the cap is enforced from
 * `fstat` before any byte moves.
 */
async function readUnitBounded(unitPath: string): Promise<string | null> {
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
    if (!dirStat.isDirectory() || !uidMatches(dirStat.uid)) return null;
    let handle;
    try {
      handle = await fs.open(`/proc/self/fd/${directory.fd}/${path.basename(unitPath)}`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      return null;
    }
    try {
      const before = await handle.stat();
      if (!before.isFile() || !uidMatches(before.uid) || before.size > UNIT_MAX_BYTES) return null;
      const buffer = Buffer.alloc(Number(before.size));
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
        if (!bytesRead) return null;
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs) return null;
      return buffer.toString("utf-8");
    } finally {
      await handle.close();
    }
  } finally {
    await directory.close();
  }
}

async function ownedUserUnit(unitPath: string, root: string): Promise<boolean> {
  const text = await readUnitBounded(unitPath);
  return text !== null && isOwnedOrcaUnit(text, root);
}

/**
 * User-scope unit state only. Never falls through to the system scope: an Orca
 * action must never signal a foreign system unit of the same name.
 */
export async function userUnitState(service: string = ORCA_SERVICE): Promise<"active" | "inactive" | "missing" | "unavailable"> {
  const result = await runProgram("systemctl", ["--user", "show", "-p", "LoadState", "-p", "ActiveState", service], 10_000, userBusEnv());
  if (result.code !== 0) return "unavailable";
  const load = /LoadState=(\S+)/.exec(result.stdout)?.[1];
  if (!load || load === "not-found") return "missing";
  return /ActiveState=(?:active|activating|deactivating|reloading)\b/.test(result.stdout) ? "active" : "inactive";
}

/** A same-name unit that exists in either scope — used only to explain a refusal. */
async function sameNamePresent(service: string): Promise<boolean> {
  for (const scope of [["--user"], []] as const) {
    const result = await runProgram("systemctl", [...scope, "show", "-p", "LoadState", service], 10_000, scope.length ? userBusEnv() : undefined);
    const load = result.code === 0 ? /LoadState=(\S+)/.exec(result.stdout)?.[1] : undefined;
    if (load && load !== "not-found") return true;
  }
  return false;
}

// Rehashing the whole release on every poll is unbounded work. Cache the verified
// version against the receipt file's identity: a rewrite/replace (tamper) changes
// the key and forces a fresh adapter verification.
let receiptCache: { root: string; key: string; version: string | null } | null = null;

async function verifiedInstallVersion(root: string, adapterPath: string): Promise<string | null> {
  const receiptPath = path.join(root, INSTALL_RECEIPT);
  let key: string;
  try {
    const info = await fs.lstat(receiptPath);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    if (!uidMatches(info.uid)) return null;
    key = `${info.ino}:${info.size}:${info.mtimeMs}`;
  } catch {
    return null;
  }
  if (receiptCache && receiptCache.root === root && receiptCache.key === key) return receiptCache.version;
  const result = await runProgram(adapterPath, ["--version"], VERSION_TIMEOUT_MS, { ORCA_HOME: root });
  const printed = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
  // The adapter prints the pinned version only for a release it rehashed and
  // validated; any other non-empty string is not proof.
  const version = printed === EXPECTED_ORCA_VERSION ? printed : null;
  receiptCache = { root, key, version };
  return version;
}

export interface OrcaDetectionDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** This repo's `scripts/managed-app-orca`, invoked with the fixed `--version` argv. */
  adapterPath: string;
}

export async function detectOrca({ env = process.env, home = os.homedir(), adapterPath }: OrcaDetectionDeps): Promise<ManagedInstallation> {
  const rootResult = resolveOrcaManagedRoot(env);
  const root = rootResult.ok ? rootResult.root : null;
  const unitIsOurs = root !== null && (await ownedUserUnit(orcaUserUnitPath(home), root));
  const version = root !== null ? await verifiedInstallVersion(root, adapterPath) : null;

  if (unitIsOurs && version) {
    return { type: "systemd", serviceName: ORCA_SERVICE, serviceNames: [ORCA_SERVICE], owned: true };
  }

  const diagnostic = !rootResult.ok
    ? "Orca's managed root (ORCA_HOME) is invalid, so no mso-orca.service can be treated as MSO-installed."
    : unitIsOurs && !version
      ? "mso-orca.service is MSO-owned but has no verified install receipt; refusing to manage it."
      : (await sameNamePresent(ORCA_SERVICE))
        ? "A mso-orca.service exists that MSO did not create (foreign unit or wrong scope); refusing to manage it."
        : null;
  return { type: "not-installed", diagnostic };
}

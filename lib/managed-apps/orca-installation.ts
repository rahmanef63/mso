import "server-only";
import { promises as fs } from "node:fs";
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
 *   1. the exact USER unit file at `~/.config/systemd/user/mso-orca.service`,
 *      a regular owner-owned file (no symlink) carrying MSO's marker and the
 *      fixed `scripts/orca/cli.mjs run --managed-root …` argv, and
 *   2. a verified install receipt, read by invoking the adapter's exact
 *      `readInstalledOrcaRelease` contract (`--version`), which rehashes the
 *      immutable release root. No bare unit owner, no arbitrary version string.
 * Anything else (foreign unit, wrong scope, missing/invalid receipt) is
 * `not-installed` + a diagnostic, and mutation/install is refused.
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
const INSTALL_RECEIPT = "managed-install.json";
const VERSION_TIMEOUT_MS = 20_000;

export function orcaUserUnitPath(home: string = os.homedir()): string {
  return path.join(home, ".config", "systemd", "user", ORCA_SERVICE);
}

/** Mirrors `isManagedOrcaUnit` in scripts/orca/systemd-unit.mjs (marker + fixed argv). */
export function isOwnedOrcaUnit(text: string): boolean {
  const lines = text.split(/\r?\n/);
  return (
    lines.includes(ORCA_UNIT_MARKER) &&
    /^ExecStart=.*\/scripts\/orca\/cli\.mjs(?:["\s])/m.test(text) &&
    /--managed-root/.test(text)
  );
}

/** A symlink, a non-regular file, or a foreign-owned file is not ours. */
async function ownedUserUnit(unitPath: string): Promise<boolean> {
  try {
    const info = await fs.lstat(unitPath);
    if (info.isSymbolicLink() || !info.isFile()) return false;
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) return false;
    return isOwnedOrcaUnit(await fs.readFile(unitPath, "utf8"));
  } catch {
    return false;
  }
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
    if (typeof process.getuid === "function" && info.uid !== process.getuid()) return null;
    key = `${info.ino}:${info.size}:${info.mtimeMs}`;
  } catch {
    return null;
  }
  if (receiptCache && receiptCache.root === root && receiptCache.key === key) return receiptCache.version;
  const result = await runProgram(adapterPath, ["--version"], VERSION_TIMEOUT_MS, { ORCA_HOME: root });
  const version = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0] || null : null;
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
  const unitIsOurs = await ownedUserUnit(orcaUserUnitPath(home));
  const version = rootResult.ok ? await verifiedInstallVersion(rootResult.root, adapterPath) : null;

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

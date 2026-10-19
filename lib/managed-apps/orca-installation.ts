import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ownerUidMatches, proveOwnedOrcaUnit, readOrcaUnitText, type OrcaUnitProof } from "./orca-unit-proof";
import { resolveOrcaManagedRoot } from "./orca-private-fs";
import { runProgram } from "./runner";
import { userBusEnv } from "./user-bus";

export { ORCA_UNIT_MARKER } from "./orca-unit-proof";

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
/** Mirrors `scripts/orca/constants.mjs` `ORCA_VERSION`; a receipt must match it. */
export const EXPECTED_ORCA_VERSION = "1.4.230";
const INSTALL_RECEIPT = "managed-install.json";
const VERSION_TIMEOUT_MS = 20_000;

export function orcaUserUnitPath(home: string = os.homedir()): string {
  return path.join(home, ".config", "systemd", "user", ORCA_SERVICE);
}

/** This repository's canonical CLI entry point, as `renderOrcaServiceUnit` writes it. */
export function canonicalOrcaCliPath(cwd: string = process.cwd()): string {
  return path.join(cwd, "scripts", "orca", "cli.mjs");
}

/** Exact generated ownership, read bounded/symlink-proof via `orca-unit-files`.
 *  `reinstall-required` is an old MSO unit whose receipt predates the recorded
 *  launcher identity: it is never silently adopted. */
async function orcaUnitProof(unitPath: string, root: string): Promise<OrcaUnitProof> {
  const text = await readOrcaUnitText(unitPath);
  return text === null ? "not-owned" : proveOwnedOrcaUnit(text, root, canonicalOrcaCliPath());
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

export type OrcaRunState = "running" | "stopped" | "unknown";

/** User-scope only. A `--user` bus outage (`unavailable`) or an owned unit systemd
 *  does not load (`missing`) is `unknown`: never silently equal to `stopped`. */
export async function orcaRunState(service: string = ORCA_SERVICE): Promise<OrcaRunState> {
  const state = await userUnitState(service);
  if (state === "active") return "running";
  if (state === "inactive") return "stopped";
  return "unknown";
}

/** Attached to a view whose owned unit state MSO could not confirm. */
export function orcaUnknownDiagnostic(service: string): string {
  return `Cannot confirm whether ${service} is running: its user-scope systemd state is unknown (no user systemd bus, or the unit is not loaded). It is not reported as stopped.`;
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

const RECEIPT_CACHE_TTL_MS = 30_000;

// Rehashing the whole release on every poll is unbounded work. Cache the verified
// version against the receipt file's identity and security metadata: a rewrite/replace (tamper)
// changes the key and forces a fresh adapter verification. Read status cache max 30s.
let receiptCache: { root: string; key: string; version: string | null; cachedAt: number } | null = null;

async function verifiedInstallVersion(root: string, adapterPath: string, fresh = false): Promise<string | null> {
  const receiptPath = path.join(root, INSTALL_RECEIPT);
  let key: string;
  try {
    const info = await fs.lstat(receiptPath);
    if (info.isSymbolicLink() || !info.isFile()) return null;
    if (!ownerUidMatches(info.uid)) return null;
    if ((info.mode & 0o077) !== 0) return null;
    key = `${adapterPath}:${info.uid}:${info.mode}:${info.ctimeMs}:${info.ino}:${info.size}:${info.mtimeMs}`;
  } catch {
    return null;
  }
  if (!fresh && receiptCache && receiptCache.root === root && receiptCache.key === key && Date.now() - receiptCache.cachedAt < RECEIPT_CACHE_TTL_MS) {
    return receiptCache.version;
  }
  const result = await runProgram(adapterPath, ["--version"], VERSION_TIMEOUT_MS, { ORCA_HOME: root });
  const printed = result.code === 0 ? result.stdout.trim().split(/\r?\n/)[0] : "";
  // The adapter prints the pinned version only for a release it rehashed and
  // validated; any other non-empty string is not proof.
  const version = printed === EXPECTED_ORCA_VERSION ? printed : null;
  receiptCache = { root, key, version, cachedAt: Date.now() };
  return version;
}

export interface OrcaDetectionDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
  /** This repo's `scripts/managed-app-orca`, invoked with the fixed `--version` argv. */
  adapterPath: string;
  freshVerification?: boolean;
}

export async function detectOrca({ env = process.env, home = os.homedir(), adapterPath, freshVerification = false }: OrcaDetectionDeps): Promise<ManagedInstallation> {
  const rootResult = resolveOrcaManagedRoot(env);
  const root = rootResult.ok ? rootResult.root : null;
  const proof = root !== null ? await orcaUnitProof(orcaUserUnitPath(home), root) : "not-owned";
  const unitIsOurs = proof === "owned";
  const version = root !== null ? await verifiedInstallVersion(root, adapterPath, freshVerification) : null;

  if (unitIsOurs && version) {
    return { type: "systemd", serviceName: ORCA_SERVICE, serviceNames: [ORCA_SERVICE], owned: true };
  }

  const diagnostic = !rootResult.ok
    ? "Orca's managed root (ORCA_HOME) is invalid, so no mso-orca.service can be treated as MSO-installed."
    : proof === "reinstall-required"
      ? "mso-orca.service was installed by an older MSO release that did not record its launcher identity; reinstall Orca with this MSO version to manage it."
      : unitIsOurs && !version
        ? "mso-orca.service is MSO-owned but has no verified install receipt; refusing to manage it."
        : (await sameNamePresent(ORCA_SERVICE))
          ? "A mso-orca.service exists that MSO did not create (foreign unit or wrong scope); refusing to manage it."
          : null;
  return { type: "not-installed", diagnostic };
}

export interface OrcaStopDetectionDeps {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

/**
 * Narrow ownership proof for stop containment ONLY.
 * Verifies exact USER unit and trusted launcher config without requiring release integrity,
 * allowing an operator to safely stop/contain a running daemon even when the release is corrupt.
 */
export async function detectOwnedOrcaForStop({
  env = process.env,
  home = os.homedir(),
}: OrcaStopDetectionDeps = {}): Promise<ManagedInstallation> {
  const rootResult = resolveOrcaManagedRoot(env);
  const root = rootResult.ok ? rootResult.root : null;
  const proof = root !== null ? await orcaUnitProof(orcaUserUnitPath(home), root) : "not-owned";
  if (proof === "owned") {
    return { type: "systemd", serviceName: ORCA_SERVICE, serviceNames: [ORCA_SERVICE], owned: true };
  }

  const diagnostic = !rootResult.ok
    ? "Orca's managed root (ORCA_HOME) is invalid, so no mso-orca.service can be treated as MSO-installed."
    : proof === "reinstall-required"
      ? "mso-orca.service was installed by an older MSO release that did not record its launcher identity; reinstall Orca with this MSO version to manage it."
      : (await sameNamePresent(ORCA_SERVICE))
        ? "A mso-orca.service exists that MSO did not create (foreign unit or wrong scope); refusing to manage it."
        : null;
  return { type: "not-installed", diagnostic };
}

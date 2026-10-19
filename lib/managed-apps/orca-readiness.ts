/**
 * Server-only Orca private readiness parser and bridge.
 * Reads private-status.json exclusively from the fixed managed root.
 * Validates version 1.4.230, port 6769 loopback, terminal daemon health,
 * process liveness, and pairing invariants.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { managedAppOrigin } from "./origin";
import { validateOrcaPairingUrl } from "./orca-pairing";

export interface OrcaReadinessSuccess {
  available: true;
  pairingUrl: string;
  webClientUrl: string | null;
  runtimeId: string;
}

export interface OrcaReadinessUnavailable {
  available: false;
  reason: string;
}

export type OrcaReadinessResult = OrcaReadinessSuccess | OrcaReadinessUnavailable;

export function getOrcaManagedRoot(): string {
  const custom = process.env.ORCA_HOME?.trim();
  if (custom && path.isAbsolute(custom) && !custom.includes("..")) {
    return path.normalize(custom);
  }
  return path.join(os.homedir(), ".local", "share", "mso", "orca");
}

export function getOrcaPrivateStatusPath(): string {
  return path.join(getOrcaManagedRoot(), "private-status.json");
}

export function getOrcaRuntimeIdentityPath(): string {
  return path.join(getOrcaManagedRoot(), "runtime-identity.json");
}

async function verifyStatusFileSecurity(rootPath: string, filePath: string): Promise<boolean> {
  try {
    const rootStat = await fs.lstat(rootPath);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return false;
    if ((rootStat.mode & 0o077) !== 0) return false;
    if (typeof process.getuid === "function" && rootStat.uid !== process.getuid()) return false;

    const fileStat = await fs.lstat(filePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false;
    if ((fileStat.mode & 0o077) !== 0) return false;
    if (typeof process.getuid === "function" && fileStat.uid !== process.getuid()) return false;
    if (fileStat.size > 65536) return false;

    return true;
  } catch {
    return false;
  }
}

function checkProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    return code === "EPERM"; // Process exists with distinct credentials
  }
}

export async function parseOrcaPrivateStatus(content: string, origin: string): Promise<OrcaReadinessResult> {
  let data: Record<string, any>;
  try {
    data = JSON.parse(content);
  } catch {
    return { available: false, reason: "invalid_json" };
  }

  // 1. Artifact version 1.4.230 check
  const version = data.artifactVersion ?? data.health?.buildVersion;
  if (version !== "1.4.230") return { available: false, reason: "incompatible_version" };

  // 2. Bound endpoint must be loopback on port 6769
  if (typeof data.boundEndpoint !== "string") return { available: false, reason: "missing_bound_endpoint" };
  try {
    const bound = new URL(data.boundEndpoint);
    if (bound.hostname !== "127.0.0.1" && bound.hostname !== "localhost") {
      return { available: false, reason: "non_loopback_bound_endpoint" };
    }
    if (bound.port !== "6769") return { available: false, reason: "unexpected_bound_port" };
  } catch {
    return { available: false, reason: "malformed_bound_endpoint" };
  }

  // 3. Advertised endpoint must match configured Orca WSS origin
  if (typeof data.advertisedEndpoint !== "string") return { available: false, reason: "missing_advertised_endpoint" };
  try {
    const adv = new URL(data.advertisedEndpoint);
    const expectedAdv = origin.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:").toLowerCase();
    if (adv.origin.toLowerCase() !== expectedAdv) return { available: false, reason: "advertised_origin_mismatch" };
  } catch {
    return { available: false, reason: "malformed_advertised_endpoint" };
  }

  // 4. Runtime ID
  if (typeof data.runtimeId !== "string" || !data.runtimeId.trim()) {
    return { available: false, reason: "missing_runtime_id" };
  }

  // 5. Health & terminal daemon checks
  const health = data.health;
  if (!health || typeof health.pid !== "number") return { available: false, reason: "missing_health_pid" };
  if (!checkProcessRunning(health.pid)) return { available: false, reason: "process_dead" };

  const td = health.terminalDaemon;
  if (!td || td.state !== "live" || td.ownsFreshSessions !== true || td.selfTest?.ok !== true) {
    return { available: false, reason: "terminal_daemon_unhealthy" };
  }

  // 6. Pairing readiness validation
  const pairing = data.pairing;
  if (!pairing || pairing.available !== true || pairing.scope !== "runtime") {
    return { available: false, reason: "pairing_unavailable" };
  }
  if (typeof pairing.url !== "string") return { available: false, reason: "missing_pairing_url" };

  const validatedOffer = validateOrcaPairingUrl(pairing.url, origin);
  if (!validatedOffer) return { available: false, reason: "invalid_pairing_offer" };

  let webClientUrl: string | null = null;
  if (typeof pairing.webClientUrl === "string" && pairing.webClientUrl) {
    try {
      const parsedWeb = new URL(pairing.webClientUrl);
      if (parsedWeb.origin.toLowerCase() === origin.toLowerCase()) {
        webClientUrl = pairing.webClientUrl;
      }
    } catch {
      webClientUrl = null;
    }
  }

  return {
    available: true,
    pairingUrl: pairing.url,
    webClientUrl,
    runtimeId: data.runtimeId,
  };
}

export async function getOrcaReadiness(): Promise<OrcaReadinessResult> {
  const origin = managedAppOrigin("orca");
  if (!origin) return { available: false, reason: "origin_unavailable" };

  const root = getOrcaManagedRoot();
  const statusFile = getOrcaPrivateStatusPath();

  const secure = await verifyStatusFileSecurity(root, statusFile);
  if (!secure) return { available: false, reason: "status_file_insecure_or_missing" };

  let result: OrcaReadinessResult;
  try {
    const raw = await fs.readFile(statusFile, "utf-8");
    result = await parseOrcaPrivateStatus(raw, origin);
  } catch {
    return { available: false, reason: "read_failed" };
  }

  if (!result.available) return result;

  const identityFile = getOrcaRuntimeIdentityPath();
  try {
    await fs.access(identityFile);
    const idSecure = await verifyStatusFileSecurity(root, identityFile);
    if (!idSecure) return { available: false, reason: "runtime_identity_insecure" };
    const idData = JSON.parse(await fs.readFile(identityFile, "utf-8"));
    if (
      idData.schemaVersion !== 1 ||
      idData.version !== "1.4.230" ||
      idData.runtimeId !== result.runtimeId ||
      typeof idData.serverPid !== "number" ||
      !checkProcessRunning(idData.serverPid)
    ) {
      return { available: false, reason: "runtime_identity_mismatch" };
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "ENOENT") return { available: false, reason: "runtime_identity_insecure" };
  }

  return result;
}

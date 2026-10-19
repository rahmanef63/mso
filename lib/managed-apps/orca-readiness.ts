/**
 * Server-only Orca private readiness parser and bridge.
 *
 * Fail-closed: the bridge is available ONLY when the upstream `orca_server_ready`
 * readiness tag, the MSO runtime-identity receipt, and the actual owned kernel
 * process all agree. Any missing, stale, reused, foreign, or unreadable identity
 * denies. No fallback to a static asset check, a bare live PID, or a personal
 * `~/.orca` profile.
 */
import "server-only";
import { managedAppOrigin } from "./origin";
import { buildOrcaWebClientUrl, validateOrcaPairingUrl } from "./orca-pairing";
import { readOrcaPrivateFile, resolveOrcaManagedRoot } from "./orca-private-fs";
import {
  parseOrcaRuntimeReceipt,
  readLinuxProcessSnapshot,
  receiptPathsAreContained,
  verifyOrcaProcessIdentity,
  type OrcaProcessReader,
} from "./orca-process-identity";

export interface OrcaReadinessSuccess {
  available: true;
  pairingUrl: string;
  webClientUrl: string;
  runtimeId: string;
  serverPid: number;
  boundEndpoint: string;
  advertisedEndpoint: string;
}
export interface OrcaReadinessUnavailable {
  available: false;
  reason: string;
}
export type OrcaReadinessResult = OrcaReadinessSuccess | OrcaReadinessUnavailable;
export interface OrcaReadinessDeps {
  env?: NodeJS.ProcessEnv;
  readProcess?: OrcaProcessReader;
}

const ORCA_VERSION = "1.4.230";
const ORCA_NODE_VERSION = "24.21.0";
const ORCA_NODE_ABI = "137";
const DEFAULT_MANAGED_PORT = 6769;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

const deny = (reason: string): OrcaReadinessUnavailable => ({ available: false, reason });

/** Managed port comes from config (default 6769), never a hardcoded user-port block. */
export function orcaManagedPort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.ORCA_DASHBOARD_URL;
  if (raw) {
    try {
      const url = new URL(raw);
      const port = Number(url.port || (url.protocol === "https:" ? 443 : url.protocol === "http:" ? 80 : NaN));
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    } catch {
      /* fall through to the default */
    }
  }
  return DEFAULT_MANAGED_PORT;
}

function parseLoopbackWs(value: unknown, managedPort: number): "ok" | "malformed" | "non_loopback" | "bad_port" {
  if (typeof value !== "string") return "malformed";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "malformed";
  }
  if (url.protocol !== "ws:" || url.username || url.password) return "malformed";
  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) return "malformed";
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) return "non_loopback";
  if (Number(url.port) !== managedPort) return "bad_port";
  return "ok";
}

function advertisedMatches(value: unknown, origin: string): "ok" | "malformed" | "mismatch" {
  if (typeof value !== "string") return "malformed";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "malformed";
  }
  if (url.protocol !== "wss:" || url.username || url.password) return "mismatch";
  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) return "mismatch";
  const expected = `${new URL(origin).host.toLowerCase()}`;
  return url.host.toLowerCase() === expected ? "ok" : "mismatch";
}

export async function parseOrcaPrivateStatus(
  content: string,
  origin: string,
  managedPort: number = orcaManagedPort(),
): Promise<OrcaReadinessResult> {
  let data: Record<string, any>;
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return deny("invalid_json");
    data = parsed as Record<string, any>;
  } catch {
    return deny("invalid_json");
  }

  if (data.type !== "orca_server_ready") return deny("unexpected_status_type");
  if (data.schemaVersion !== 1) return deny("unsupported_status_schema");
  if (typeof data.runtimeId !== "string" || !data.runtimeId.trim()) return deny("missing_runtime_id");

  const health = data.health;
  if (!health || typeof health !== "object") return deny("incompatible_version");
  // The REAL health buildVersion is authoritative; `artifactVersion` never overrides it.
  if (health.buildVersion !== ORCA_VERSION) return deny("incompatible_version");
  if (String(health.nodeVersion) !== ORCA_NODE_VERSION) return deny("incompatible_node_version");
  if (String(health.nodeAbi) !== ORCA_NODE_ABI) return deny("incompatible_node_abi");
  if (!Number.isInteger(health.pid) || health.pid <= 1) return deny("missing_health_pid");
  const daemon = health.terminalDaemon;
  if (!daemon || daemon.state !== "live" || daemon.ownsFreshSessions !== true || daemon.selfTest?.ok !== true) {
    return deny("terminal_daemon_unhealthy");
  }

  const bound = parseLoopbackWs(data.boundEndpoint, managedPort);
  if (bound === "malformed") return deny("malformed_bound_endpoint");
  if (bound === "non_loopback") return deny("non_loopback_bound_endpoint");
  if (bound === "bad_port") return deny("unexpected_bound_port");

  if (data.advertisedEndpoint === undefined) return deny("missing_advertised_endpoint");
  const advertised = advertisedMatches(data.advertisedEndpoint, origin);
  if (advertised === "malformed") return deny("malformed_advertised_endpoint");
  if (advertised === "mismatch") return deny("advertised_origin_mismatch");

  const pairing = data.pairing;
  if (!pairing || pairing.available !== true || pairing.scope !== "runtime") return deny("pairing_unavailable");
  if (typeof pairing.url !== "string") return deny("missing_pairing_url");
  if (!validateOrcaPairingUrl(pairing.url, origin)) return deny("invalid_pairing_offer");

  return {
    available: true,
    pairingUrl: pairing.url,
    webClientUrl: buildOrcaWebClientUrl(origin, pairing.url),
    runtimeId: data.runtimeId,
    serverPid: health.pid,
    boundEndpoint: data.boundEndpoint,
    advertisedEndpoint: data.advertisedEndpoint,
  };
}

export async function getOrcaReadiness(deps: OrcaReadinessDeps = {}): Promise<OrcaReadinessResult> {
  const origin = managedAppOrigin("orca");
  if (!origin) return deny("origin_unavailable");
  const env = deps.env ?? process.env;

  const rootResult = resolveOrcaManagedRoot(env);
  if (!rootResult.ok) return deny("managed_root_invalid");
  const root = rootResult.root;

  const statusRead = await readOrcaPrivateFile(root, "private-status.json");
  if (!statusRead.ok) return deny(statusRead.reason === "missing" ? "status_file_missing" : "status_file_insecure");
  const parsed = await parseOrcaPrivateStatus(statusRead.text, origin, orcaManagedPort(env));
  if (!parsed.available) return parsed;

  // The runtime-identity receipt is MANDATORY: a readiness file alone is not ownership proof.
  const identityRead = await readOrcaPrivateFile(root, "runtime-identity.json");
  if (!identityRead.ok) return deny(identityRead.reason === "missing" ? "runtime_identity_missing" : "runtime_identity_insecure");
  const receipt = parseOrcaRuntimeReceipt(identityRead.text);
  if (!receipt) return deny("runtime_identity_invalid");
  if (!receiptPathsAreContained(receipt, root)) return deny("runtime_identity_mismatch");
  if (receipt.runtimeId !== parsed.runtimeId || receipt.version !== ORCA_VERSION) return deny("runtime_identity_mismatch");
  if (receipt.serverPid !== parsed.serverPid) return deny("runtime_identity_mismatch");
  if (receipt.boundEndpoint !== parsed.boundEndpoint || receipt.advertisedEndpoint !== parsed.advertisedEndpoint) {
    return deny("runtime_identity_mismatch");
  }

  const readProcess = deps.readProcess ?? readLinuxProcessSnapshot;
  const snapshot = await readProcess(receipt.serverPid);
  if (!snapshot) return deny("process_identity_unavailable");
  if (!verifyOrcaProcessIdentity(receipt, snapshot, root)) return deny("process_identity_mismatch");

  return parsed;
}

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
import { readOrcaPrivateFile, resolveOrcaManagedRoot } from "./orca-private-fs";
import {
  parseOrcaRuntimeReceipt,
  readLinuxProcessSnapshot,
  receiptPathsAreContained,
  verifyOrcaProcessIdentity,
  verifyOrcaCanonicalIdentity,
  type OrcaProcessReader,
} from "./orca-process-identity";
import { verifyOrcaListenerBinding, type OrcaListenerBindingResult } from "./orca-runtime-binding";
import {
  ORCA_VERSION,
  deny,
  orcaManagedPort,
  parseOrcaPrivateStatus,
  type OrcaReadinessResult,
} from "./orca-readiness-parse";

export {
  DEFAULT_MANAGED_PORT,
  ORCA_NODE_ABI,
  ORCA_NODE_VERSION,
  ORCA_VERSION,
  deny,
  orcaManagedPort,
  parseOrcaPrivateStatus,
  type OrcaReadinessResult,
  type OrcaReadinessSuccess,
  type OrcaReadinessUnavailable,
} from "./orca-readiness-parse";

export interface OrcaBindingInput {
  pid: number;
  startTicks: string;
  boundEndpoint: string;
}
export type OrcaBindingReader = (input: OrcaBindingInput) => Promise<OrcaListenerBindingResult>;
export interface OrcaReadinessDeps {
  env?: NodeJS.ProcessEnv;
  readProcess?: OrcaProcessReader;
  readBinding?: OrcaBindingReader;
}

/** The verified bound endpoint's literal numeric loopback listener must be owned by
 *  the receipt PID. A named host (`localhost`) is never resolved as a fallback. */
const defaultBindingReader: OrcaBindingReader = async ({ pid, startTicks, boundEndpoint }) => {
  let url: URL;
  try {
    url = new URL(boundEndpoint);
  } catch {
    return { ok: false, reason: "bound_endpoint_invalid" };
  }
  if (url.protocol !== "ws:" || url.username || url.password) {
    return { ok: false, reason: "bound_endpoint_invalid" };
  }
  return verifyOrcaListenerBinding({ pid, startTicks, host: url.hostname, port: Number(url.port) });
};

export async function getOrcaReadiness(deps: OrcaReadinessDeps = {}): Promise<OrcaReadinessResult> {
  const origin = managedAppOrigin("orca");
  if (!origin) return deny("origin_unavailable");
  const env = deps.env ?? process.env;

  const rootResult = resolveOrcaManagedRoot(env);
  if (!rootResult.ok) return deny("managed_root_invalid");
  const root = rootResult.root;

  const statusRead = await readOrcaPrivateFile(root, "private-status.json");
  if (!statusRead.ok) return deny(statusRead.reason === "missing" ? "status_file_missing" : "status_file_insecure");
  const managedPort = orcaManagedPort(env);
  const parsed = await parseOrcaPrivateStatus(statusRead.text, origin, managedPort);
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
  if (!await verifyOrcaCanonicalIdentity(receipt, snapshot, root)) return deny("process_identity_mismatch");

  const readBinding = deps.readBinding ?? defaultBindingReader;
  const binding = await readBinding({
    pid: snapshot.pid,
    startTicks: snapshot.startTicks,
    boundEndpoint: parsed.boundEndpoint,
  });
  if (!binding.ok) return deny(binding.reason);

  // The listener proof has its own process checks, but readiness must not return a
  // stale composite: re-read the exact process (exe, argv, uid, canonical entry) and
  // require the same start ticks before claiming the runtime.
  const confirmed = await readProcess(receipt.serverPid);
  if (!confirmed || confirmed.startTicks !== snapshot.startTicks) return deny("process_identity_unavailable");
  if (!verifyOrcaProcessIdentity(receipt, confirmed, root)) return deny("process_identity_mismatch");
  if (!await verifyOrcaCanonicalIdentity(receipt, confirmed, root)) return deny("process_identity_mismatch");

  return { ...parsed, startTicks: confirmed.startTicks, listenerInode: binding.binding.inode };
}

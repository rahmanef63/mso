import "server-only";
import { readLinuxProcessSnapshot, type OrcaProcessReader } from "./orca-process-identity";
import {
  readLinuxListeners,
  readProcessSocketInodes,
  numericLoopbackAddress,
  type OrcaListenerBinding,
  type OrcaListenerCandidate,
} from "./orca-runtime-binding-proc";

export {
  numericLoopbackAddress,
  parseProcNetListeners,
  readLinuxListeners,
  readProcessSocketInodes,
} from "./orca-runtime-binding-proc";
export type { OrcaListenerBinding, OrcaListenerCandidate } from "./orca-runtime-binding-proc";

/**
 * The owned server PID must be the process LISTENing on the configured loopback
 * endpoint. Liveness plus a port probe is not proof: another process can own the
 * port while the receipt PID stays alive. This is a point-in-time inode association,
 * not a kernel guarantee that a later accept() reaches the same process.
 */
export type OrcaListenerBindingResult =
  | { ok: true; binding: OrcaListenerBinding }
  | { ok: false; reason: string };

export interface OrcaListenerBindingInput {
  pid: number;
  startTicks: string;
  host: string;
  port: number;
}

export interface OrcaListenerBindingDeps {
  platform?: NodeJS.Platform;
  readProcess?: OrcaProcessReader;
  readListeners?: (family: "ipv4" | "ipv6") => Promise<OrcaListenerCandidate[] | null>;
  readSocketInodes?: (pid: number) => Promise<Set<string> | null>;
}

const deny = (reason: string): OrcaListenerBindingResult => ({ ok: false, reason });

export async function verifyOrcaListenerBinding(
  input: OrcaListenerBindingInput,
  deps: OrcaListenerBindingDeps = {},
): Promise<OrcaListenerBindingResult> {
  if ((deps.platform ?? process.platform) !== "linux") return deny("listener_proof_unsupported_platform");
  const { pid, startTicks, port } = input;
  if (!Number.isInteger(pid) || pid <= 1) return deny("listener_process_invalid");
  if (!Number.isInteger(port) || port < 1 || port > 65535) return deny("listener_port_invalid");
  const address = numericLoopbackAddress(input.host);
  if (!address) return deny("listener_host_not_numeric_loopback");
  const family = address === "::1" ? "ipv6" : "ipv4";
  const readProcess = deps.readProcess ?? readLinuxProcessSnapshot;
  const readListeners = deps.readListeners ?? readLinuxListeners;
  const readInodes = deps.readSocketInodes ?? readProcessSocketInodes;

  const before = await readProcess(pid).catch(() => null);
  if (!before || before.pid !== pid || before.startTicks !== startTicks) return deny("listener_process_changed");
  const listenersBefore = await readListeners(family).catch(() => null);
  if (listenersBefore === null) return deny("listener_table_unreadable");
  const matching = listenersBefore.filter(
    (listener) => listener.family === family && listener.address === address && listener.port === port,
  );
  if (matching.length === 0) return deny("listener_not_found");
  // SO_REUSEPORT would hand connections to a second owner; refuse ambiguity.
  if (matching.length !== 1) return deny("listener_ambiguous");
  const binding = matching[0];

  const inodes = await readInodes(pid).catch(() => null);
  if (inodes === null) return deny("process_socket_fds_unreadable");
  if (!inodes.has(binding.inode)) return deny("listener_not_owned_by_process");

  const after = await readProcess(pid).catch(() => null);
  if (!after || after.pid !== pid || after.startTicks !== startTicks) return deny("listener_process_changed");
  const listenersAfter = await readListeners(family).catch(() => null);
  if (listenersAfter === null) return deny("listener_table_unreadable");
  const still = listenersAfter.filter(
    (listener) => listener.family === family && listener.address === address && listener.port === port,
  );
  if (still.length !== 1 || still[0].inode !== binding.inode) return deny("listener_changed");
  return { ok: true, binding };
}

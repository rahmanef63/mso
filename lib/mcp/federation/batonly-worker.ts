import { inspectSiCoderFederationRuntime } from "@/lib/federation/si-coder-runtime";
import { FEDERATION_WORKER_ID, safeFederationError, safeFederationResult } from "@/lib/federation/security";
import { MCP_SERVER_VERSION, MCP_TOOLSET_VERSION } from "../toolset";
import { asFederationRequest, batonFederationConfigured, defaultBatonCall, resolveBatonFederationProject } from "./baton-client";
import { executeFederationRequest, msoFederationToolCount } from "./execution";
import {
  BASE_POLL_MS,
  FEDERATION_WORKER_VERSION,
  HEARTBEAT_MS,
  MAX_BACKOFF_MS,
  type BatonCall,
  type BatonlyFederationWorkerStatus,
} from "./types";

export { executeMsoFederation } from "./execution";
export type { FederationRequest } from "./types";

const state: BatonlyFederationWorkerStatus = {
  running: false,
  connected: false,
  consecutiveFailures: 0,
  msoToolCount: msoFederationToolCount(),
};

let timer: ReturnType<typeof setTimeout> | null = null;
let lastHeartbeatAttempt = 0;
let runtimeCache: { at: number; version: string; functionCount: number } | null = null;
let active = false;

async function siCoderRuntime(cwd = process.cwd()) {
  if (runtimeCache && Date.now() - runtimeCache.at < 10 * 60_000) return runtimeCache;
  const runtime = await inspectSiCoderFederationRuntime(cwd);
  runtimeCache = { at: Date.now(), version: runtime.version, functionCount: runtime.functionCount };
  state.siCoderFunctionCount = runtime.functionCount;
  state.siCoderVersion = runtime.version;
  return runtimeCache;
}

async function heartbeat(call: BatonCall, cwd: string, force = false) {
  const now = Date.now();
  if (!force && now - lastHeartbeatAttempt < HEARTBEAT_MS) return;
  lastHeartbeatAttempt = now;
  const sc = await siCoderRuntime(cwd);
  await call("baton_federation_worker_heartbeat", {
    workerId: FEDERATION_WORKER_ID,
    workerVersion: FEDERATION_WORKER_VERSION,
    msoVersion: MCP_SERVER_VERSION,
    msoToolsetVersion: MCP_TOOLSET_VERSION,
    msoToolCount: msoFederationToolCount(),
    siCoderVersion: sc.version,
    siCoderFunctionCount: sc.functionCount,
    siCoderSkillCount: 22,
    ...(state.lastRequestId ? { lastRequestId: state.lastRequestId } : {}),
    lastOutcome: state.lastOutcome ?? "idle",
  });
  state.lastHeartbeatAt = now;
}

function retryableError(message: string) {
  return /(timed? ?out|temporar|unavailable|ECONN|fetch|connection|network|502|503|504)/i.test(message);
}

export async function runBatonlyFederationPoll(options: { batonCall?: BatonCall; cwd?: string } = {}) {
  const call = options.batonCall ?? defaultBatonCall;
  const cwd = options.cwd ?? process.cwd();
  state.lastPollAt = Date.now();
  await heartbeat(call, cwd);

  const raw = await call("baton_federation_requests_list", { pendingOnly: true, limit: 10 });
  if (!Array.isArray(raw)) throw new Error("Batonly pending federation response must be an array");
  state.connected = true;
  if (!raw.length) {
    state.lastOutcome = "idle";
    return { processed: 0 };
  }

  const summary = asFederationRequest(raw[0]);
  const claimed = asFederationRequest(await call("baton_federation_request_claim", {
    requestId: summary.id,
    workerId: FEDERATION_WORKER_ID,
    leaseMs: 120_000,
  }));
  state.currentRequestId = claimed.id;

  try {
    const result = await executeFederationRequest(claimed, cwd);
    const safe = safeFederationResult({
      source: claimed.source,
      operation: claimed.operation,
      durationEvidence: "executed by approved MSO federation worker",
      result,
    });
    await call("baton_federation_request_complete", {
      requestId: claimed.id,
      workerId: FEDERATION_WORKER_ID,
      resultJson: safe.json,
    });
    state.lastRequestId = claimed.id;
    state.lastOutcome = "succeeded";
    state.lastSuccessAt = Date.now();
    return { processed: 1, requestId: claimed.id, outcome: "succeeded" as const };
  } catch (error) {
    const message = safeFederationError(error);
    await call("baton_federation_request_fail", {
      requestId: claimed.id,
      workerId: FEDERATION_WORKER_ID,
      errorCode: "FEDERATION_EXECUTION_FAILED",
      errorMessage: message,
      retryable: retryableError(message),
    }).catch(() => undefined);
    state.lastRequestId = claimed.id;
    state.lastOutcome = "failed";
    throw error;
  } finally {
    state.currentRequestId = undefined;
    await heartbeat(call, cwd, true).catch(() => undefined);
  }
}

function schedule(delay: number) {
  state.nextPollInMs = delay;
  timer = setTimeout(() => {
    timer = null;
    void loop();
  }, delay);
  timer.unref();
}

async function loop() {
  if (!active) return;
  try {
    await runBatonlyFederationPoll();
    state.connected = true;
    state.lastError = undefined;
    state.consecutiveFailures = 0;
    schedule(BASE_POLL_MS);
  } catch (error) {
    state.connected = false;
    state.lastError = safeFederationError(error);
    state.consecutiveFailures += 1;
    schedule(Math.min(MAX_BACKOFF_MS, BASE_POLL_MS * 2 ** Math.min(state.consecutiveFailures, 3)));
  }
}

export async function startBatonlyFederationWorker() {
  if (process.env.MSO_BATONLY_FEDERATION_DISABLED === "1" || active) return getBatonlyFederationWorkerStatus();
  try {
    const project = await resolveBatonFederationProject();
    state.batonProject = project.id;
    if (!(await batonFederationConfigured())) return getBatonlyFederationWorkerStatus();
  } catch {
    return getBatonlyFederationWorkerStatus();
  }
  active = true;
  state.running = true;
  schedule(250);
  return getBatonlyFederationWorkerStatus();
}

export function stopBatonlyFederationWorker() {
  active = false;
  state.running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  state.nextPollInMs = undefined;
}

export function getBatonlyFederationWorkerStatus(): BatonlyFederationWorkerStatus {
  return { ...state };
}

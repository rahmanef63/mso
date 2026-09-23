import type { FederationExecutionScope } from "@/lib/federation/si-coder-runtime";

export const FEDERATION_WORKER_VERSION = "1";
export const BATON_SERVER = "baton";
export const BASE_POLL_MS = 10_000;
export const MAX_BACKOFF_MS = 60_000;
export const HEARTBEAT_MS = 45_000;

export type FederationRequest = {
  id: string;
  projectId: string;
  source: "mso" | "si-coder";
  operation: string;
  scope: FederationExecutionScope;
  confirmed: boolean;
  status: string;
  arguments?: Record<string, unknown>;
  attempts?: number;
};

export type BatonlyFederationWorkerStatus = {
  running: boolean;
  connected: boolean;
  lastPollAt?: number;
  lastHeartbeatAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  currentRequestId?: string;
  lastRequestId?: string;
  lastOutcome?: "idle" | "succeeded" | "failed";
  consecutiveFailures: number;
  nextPollInMs?: number;
  batonProject?: string;
  msoToolCount: number;
  siCoderFunctionCount?: number;
  siCoderVersion?: string;
};

export type BatonCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;

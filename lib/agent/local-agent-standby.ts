import { randomUUID } from "node:crypto";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import { activeWorkflowForActor } from "@/lib/workflow";
import { getAgentSession } from "./session-store";
import { listLocalAgentExecutableInbox } from "./local-agent-mailbox";
import {
  localAgentConsumerConnected,
  subscribeLocalAgentStandbyMessages,
} from "./local-agent-events";
import { executeLocalAgentStandbyMessage } from "./local-agent-standby-execution";
import {
  armLocalAgentStandbyRecord,
  blockLocalAgentStandby,
  disarmLocalAgentStandbyForWorkflow,
  disarmLocalAgentStandbyRecord,
  getLocalAgentStandbyRecord,
  listAllArmedLocalAgentStandbyRecords,
} from "./local-agent-standby-store";
import type { LocalAgentStandbyRecord } from "./local-agent-types";

const runtimeId = `standby:${process.pid}:${randomUUID()}`;
const subscriptions = new Map<string, () => void>();
const inFlightSessions = new Set<string>();
let runtimeCapabilities: CapabilityRuntime | null = null;
let reconcilePromise: Promise<void> | null = null;

function executionKey(
  record: Pick<LocalAgentStandbyRecord, "principalHash" | "sessionId">,
): string {
  return `${record.principalHash}:${record.sessionId}`;
}

function removeSubscription(sessionId: string): void {
  const unsubscribe = subscriptions.get(sessionId);
  if (!unsubscribe) return;
  subscriptions.delete(sessionId);
  unsubscribe();
}

function installSubscription(record: LocalAgentStandbyRecord): void {
  if (!record.armed || subscriptions.has(record.sessionId)) return;
  const unsubscribe = subscribeLocalAgentStandbyMessages(record.sessionId, (message) => {
    if (!message.execution?.requested ||
      !message.execution.authorized ||
      message.intent !== "request") return;
    void drainStandbySession(record.principal, record.sessionId).catch(() => undefined);
  });
  subscriptions.set(record.sessionId, unsubscribe);
}

async function validateRecord(
  record: LocalAgentStandbyRecord,
): Promise<{ valid: true } | { valid: false; reason: string }> {
  const session = await getAgentSession(record.principal, record.sessionId).catch(() => null);
  if (!session) return { valid: false, reason: "standby session no longer exists" };
  const workflow = await activeWorkflowForActor(record.workflowActor, record.workflowId)
    .catch(() => null);
  if (!workflow) return { valid: false, reason: "standby workflow is no longer active" };
  return { valid: true };
}

export async function drainStandbySession(
  principal: string,
  sessionId: string,
): Promise<void> {
  if (!runtimeCapabilities) return;
  const initial = await getLocalAgentStandbyRecord(principal, sessionId).catch(() => null);
  if (!initial?.armed) return;
  const key = executionKey(initial);
  if (inFlightSessions.has(key)) return;
  inFlightSessions.add(key);
  try {
    for (let processed = 0; processed < 100; processed += 1) {
      const record = await getLocalAgentStandbyRecord(principal, sessionId);
      if (!record?.armed) break;
      const validation = await validateRecord(record);
      if (!validation.valid) {
        await blockLocalAgentStandby(principal, sessionId, validation.reason);
        removeSubscription(sessionId);
        break;
      }
      const [next] = await listLocalAgentExecutableInbox(principal, sessionId, 1);
      if (!next) break;
      const result = await executeLocalAgentStandbyMessage({
        record,
        message: next,
        capabilities: runtimeCapabilities,
        runtimeId,
      });
      if (result.fatal) {
        removeSubscription(sessionId);
        break;
      }
      if (!result.advanced) break;
    }
  } finally {
    inFlightSessions.delete(key);
  }
}

export async function ensureLocalAgentStandbyRuntime(
  capabilities: CapabilityRuntime,
): Promise<void> {
  runtimeCapabilities = capabilities;
  if (reconcilePromise) return reconcilePromise;
  reconcilePromise = (async () => {
    const records = await listAllArmedLocalAgentStandbyRecords();
    for (const record of records) {
      installSubscription(record);
      // Subscribe first, then reread durable mail to close the event/read race.
      void drainStandbySession(record.principal, record.sessionId).catch(() => undefined);
    }
  })().finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
}

export async function armLocalAgentStandby(input: {
  principal: string;
  sessionId: string;
  workflowActor: string;
  workflowId: string;
  capabilities: CapabilityRuntime;
}) {
  if (!await activeWorkflowForActor(input.workflowActor, input.workflowId))
    throw new Error("workflow_id was not found for this MSO session");
  runtimeCapabilities = input.capabilities;
  const record = await armLocalAgentStandbyRecord(input);
  installSubscription(record);
  // Server takes over reconciliation; the current MCP/HTTP call returns now.
  void drainStandbySession(input.principal, input.sessionId).catch(() => undefined);
  return {
    mode: "listen" as const,
    status: "waiting" as const,
    standbyArmed: true,
    actionable: true,
    consumerConnected: localAgentConsumerConnected(record.sessionId),
    sessionId: record.sessionId,
    workflowId: record.workflowId,
    armedAt: record.armedAt,
  };
}

export async function stopLocalAgentStandby(input: {
  principal: string;
  sessionId: string;
  workflowId: string;
}) {
  const record = await disarmLocalAgentStandbyRecord(
    input.principal,
    input.sessionId,
    input.workflowId,
    "standby explicitly stopped",
  );
  removeSubscription(input.sessionId);
  return {
    mode: "stop" as const,
    standbyArmed: false,
    sessionId: input.sessionId,
    workflowId: input.workflowId,
    changed: Boolean(record),
  };
}

export async function disarmLocalAgentStandbyWorkflow(
  workflowActor: string,
  workflowId: string,
  reason: string,
): Promise<number> {
  const changed = await disarmLocalAgentStandbyForWorkflow(workflowActor, workflowId, reason);
  for (const row of changed) removeSubscription(row.sessionId);
  return changed.length;
}

/** Test-only process-restart simulation: subscriptions are ephemeral by design. */
export function resetLocalAgentStandbyRuntimeForTest(): void {
  for (const unsubscribe of subscriptions.values()) unsubscribe();
  subscriptions.clear();
  inFlightSessions.clear();
  runtimeCapabilities = null;
  reconcilePromise = null;
}

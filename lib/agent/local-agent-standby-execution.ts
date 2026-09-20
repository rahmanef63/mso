import { randomUUID } from "node:crypto";
import { handoffOwnerLocalSession } from "@/lib/a2a/local-session";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import { activeWorkflowForActor } from "@/lib/workflow";
import {
  claimLocalAgentMessageExecution,
  finishLocalAgentMessageExecution,
} from "./local-agent-mailbox";
import { replyLocalAgentMessage } from "./local-agent-messaging";
import {
  acquireLocalAgentStandbyExecution,
  getLocalAgentStandbyRecord,
  releaseLocalAgentStandbyExecution,
  updateLocalAgentStandbyTask,
} from "./local-agent-standby-store";
import type { LocalAgentMessageView, LocalAgentStandbyRecord } from "./local-agent-types";

function taskResultText(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const task = value as {
    status?: { state?: string; message?: { parts?: Array<{ text?: string }> } };
    artifacts?: Array<{ parts?: Array<{ text?: string }> }>;
  };
  const artifactText = task.artifacts?.flatMap((artifact) => artifact.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  const statusText = task.status?.message?.parts
    ?.map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim();
  return (artifactText || statusText || fallback).slice(0, 16 * 1024);
}

function taskId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && /^task_[0-9a-f-]{36}$/.test(id) ? id : undefined;
}

function taskCompleted(value: unknown): boolean {
  return Boolean(value && typeof value === "object" &&
    (value as { status?: { state?: unknown } }).status?.state === "TASK_STATE_COMPLETED");
}

function fatalErrorMessage(message: string): boolean {
  return /workflow_id was not found|session not found|target not found|not authorized|forbidden|revoked/i.test(message);
}

async function safeReply(
  principal: string,
  sessionId: string,
  request: LocalAgentMessageView,
  text: string,
): Promise<void> {
  if (request.intent !== "request" || !request.correlationId) return;
  await replyLocalAgentMessage({
    principal,
    senderSessionId: sessionId,
    replyToMessageId: request.id,
    text: text.slice(0, 16 * 1024),
    kind: request.kind,
  }).catch(() => undefined);
}

async function finishExecution(input: {
  record: LocalAgentStandbyRecord;
  claimed: LocalAgentMessageView;
  claimant: string;
  state: "completed" | "failed";
  taskId?: string;
  error?: string;
  fatal?: boolean;
}): Promise<void> {
  await finishLocalAgentMessageExecution({
    principal: input.record.principal,
    targetSessionId: input.record.sessionId,
    messageId: input.claimed.id,
    claimedBy: input.claimant,
    state: input.state,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.error ? { error: input.error } : {}),
  }).catch(() => undefined);
  const prefix = input.state === "completed" ? "" : "Standby command failed: ";
  await safeReply(
    input.record.principal,
    input.record.sessionId,
    input.claimed,
    input.state === "completed"
      ? input.error || "Standby command completed."
      : `${prefix}${input.error || "worker failed"}`,
  );
  await releaseLocalAgentStandbyExecution({
    principal: input.record.principal,
    sessionId: input.record.sessionId,
    messageId: input.claimed.id,
    claimedBy: input.claimant,
    ...(input.state === "failed" && input.error ? { error: input.error } : {}),
    ...(input.fatal ? { fatal: true } : {}),
  }).catch(() => undefined);
}

export async function executeLocalAgentStandbyMessage(input: {
  record: LocalAgentStandbyRecord;
  message: LocalAgentMessageView;
  capabilities: CapabilityRuntime;
  runtimeId: string;
}): Promise<{ advanced: boolean; fatal: boolean }> {
  const { record, message, capabilities } = input;
  const claimant = `${input.runtimeId}:${randomUUID()}`;
  const slot = await acquireLocalAgentStandbyExecution({
    principal: record.principal,
    sessionId: record.sessionId,
    messageId: message.id,
    claimedBy: claimant,
  });
  if (!slot) return { advanced: false, fatal: false };

  const claimed = await claimLocalAgentMessageExecution({
    principal: record.principal,
    targetSessionId: record.sessionId,
    messageId: message.id,
    claimedBy: claimant,
  });
  if (!claimed) {
    await releaseLocalAgentStandbyExecution({
      principal: record.principal,
      sessionId: record.sessionId,
      messageId: message.id,
      claimedBy: claimant,
      completed: false,
    });
    return { advanced: false, fatal: false };
  }

  try {
    const fresh = await getLocalAgentStandbyRecord(record.principal, record.sessionId);
    if (!fresh?.armed || fresh.workflowId !== record.workflowId)
      throw new Error("standby workflow is no longer active");
    if (!await activeWorkflowForActor(fresh.workflowActor, fresh.workflowId))
      throw new Error("workflow_id was not found for this MSO session");

    const result = await handoffOwnerLocalSession(
      record.principal,
      record.sessionId,
      claimed.text,
      capabilities,
      undefined,
      {
        workflowId: fresh.workflowId,
        workflowActor: fresh.workflowActor,
        fixedWorkflow: true,
      },
    );
    const id = taskId(result.task);
    if (id)
      await updateLocalAgentStandbyTask(record.principal, record.sessionId, claimed.id, claimant, id);
    if (taskCompleted(result.task)) {
      await finishExecution({
        record,
        claimed,
        claimant,
        state: "completed",
        ...(id ? { taskId: id } : {}),
        error: taskResultText(result.task, "Standby command completed."),
      });
      return { advanced: true, fatal: false };
    }
    const failure = taskResultText(result.task, "Standby worker failed to complete the command.");
    await finishExecution({
      record,
      claimed,
      claimant,
      state: "failed",
      ...(id ? { taskId: id } : {}),
      error: failure,
    });
    return { advanced: true, fatal: false };
  } catch (error) {
    const messageText = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const fatal = fatalErrorMessage(messageText);
    await finishExecution({
      record,
      claimed,
      claimant,
      state: "failed",
      error: messageText,
      fatal,
    });
    return { advanced: true, fatal };
  }
}

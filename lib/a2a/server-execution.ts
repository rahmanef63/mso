import { audit } from "@/lib/host";
import type { AgentSession } from "@/lib/agent/session-types";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { A2AAuthenticatedProfile } from "./server-protocol";
import { runInboundA2AAgent } from "./inbound-agent";
import {
  registerA2AActiveTask,
  releaseA2AActiveTask,
  taskPublicView,
  updateA2ATask,
  type A2ATaskRecord,
} from "./tasks";
import {
  a2aArtifactUpdate,
  a2aStatusUpdate,
  publishA2AEvent,
  subscribeA2AEvent,
  type A2AStreamResponse,
} from "./server-events";
import { a2aRpcOk, type A2ARpcId } from "./server-protocol";

export async function executeInboundA2ATask(
  task: A2ATaskRecord,
  profile: A2AAuthenticatedProfile,
  prompt: string,
  session: AgentSession | undefined,
  capabilities: CapabilityRuntime,
): Promise<A2ATaskRecord> {
  const principal = task.principal;
  const controller = new AbortController();
  registerA2AActiveTask(task.id, controller);
  let pendingDelta = "";
  let sentArtifact = false;
  try {
    task = await updateA2ATask(task.id, principal, {
      state: "TASK_STATE_WORKING",
    });
    publishA2AEvent(task.id, a2aStatusUpdate(task));
    void audit({
      action: "a2a.inbound",
      actor: principal,
      target: task.id,
      detail: `start scope=${profile.scope}`,
      meta: { scope: profile.scope },
    });
    const result = await runInboundA2AAgent({
      prompt,
      scope: profile.scope,
      principal,
      taskId: task.id,
      session,
      signal: controller.signal,
      capabilities,
      onDelta(chunk) {
        if (pendingDelta) {
          publishA2AEvent(
            task.id,
            a2aArtifactUpdate(task, pendingDelta, sentArtifact, false),
          );
          sentArtifact = true;
        }
        pendingDelta = chunk;
      },
    });
    if (pendingDelta) {
      publishA2AEvent(
        task.id,
        a2aArtifactUpdate(task, pendingDelta, sentArtifact, true),
      );
    }
    task = await updateA2ATask(task.id, principal, {
      state: "TASK_STATE_COMPLETED",
      output: result.text,
    });
    publishA2AEvent(task.id, a2aStatusUpdate(task));
    void audit({
      action: "a2a.inbound",
      actor: principal,
      target: task.id,
      detail: `completed rounds=${result.rounds} tools=${result.toolCalls.length}`,
      meta: {
        scope: profile.scope,
        rounds: result.rounds,
        toolCalls: result.toolCalls.length,
      },
    });
    return task;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const canceled = controller.signal.aborted || /cancel/i.test(message);
    task = await updateA2ATask(task.id, principal, {
      state: canceled ? "TASK_STATE_CANCELED" : "TASK_STATE_FAILED",
      error: message,
    });
    publishA2AEvent(task.id, a2aStatusUpdate(task));
    void audit({
      action: "a2a.inbound",
      actor: principal,
      target: task.id,
      ok: false,
      detail: message.slice(0, 220),
      meta: { scope: profile.scope },
    });
    return task;
  } finally {
    releaseA2AActiveTask(task.id);
  }
}

export function a2aSseResponse(
  id: A2ARpcId,
  task: A2ATaskRecord,
  profile: A2AAuthenticatedProfile,
  capabilities: CapabilityRuntime,
  prompt?: string,
  session?: AgentSession,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: () => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (result: A2AStreamResponse) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(a2aRpcOk(id, result))}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      emit({ task: taskPublicView(task) });
      unsubscribe = subscribeA2AEvent(task.id, emit);
      if (prompt !== undefined) {
        void executeInboundA2ATask(task, profile, prompt, session, capabilities).finally(
          () => {
            unsubscribe();
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                // Client disconnected after task completion.
              }
            }
          },
        );
      }
    },
    cancel() {
      closed = true;
      unsubscribe(); // Task intentionally continues independently of this stream.
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

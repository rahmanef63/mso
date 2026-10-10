import { audit } from "@/lib/host/audit-api";
import type { AgentSession } from "@/lib/agent/session-types";
import type { CapabilityRuntime } from "@/lib/capabilities/runtime";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import { scopeRank } from "@/lib/capabilities/scope";
import { getA2AInboundProfile } from "./credentials-inbound";
import type { A2AAuthenticatedProfile } from "./server-protocol";
import { runInboundA2AAgent } from "./inbound-agent";
import {
  registerA2AActiveTask,
  getA2ATaskForPrincipal,
  releaseA2AActiveTask,
  updateA2ATask,
  type A2ATaskRecord,
} from "./tasks";
import {
  a2aArtifactUpdate,
  a2aStatusUpdate,
  publishA2AEvent,
  subscribeA2AEvent,
  registerA2AStream,
  type A2AStreamResponse,
} from "./server-events";
import { A2A_TERMINAL_STATES, a2aRpcOk, type A2ARpcId } from "./server-protocol";

export interface A2AExecutionContext {
  authority?: CapabilityRunContext;
  workflowId?: string;
  workflowActor?: string;
  fixedWorkflow?: boolean;
}

export async function executeInboundA2ATask(
  task: A2ATaskRecord,
  profile: A2AAuthenticatedProfile,
  prompt: string,
  session: AgentSession | undefined,
  capabilities: CapabilityRuntime,
  executionContext?: A2AExecutionContext,
): Promise<A2ATaskRecord> {
  const principal = task.principal;
  const controller = new AbortController();
  registerA2AActiveTask(task.id, controller, profile.local ? undefined : profile.id);
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
      executionContext,
      async liveScope() {
        if (profile.local) return profile.scope;
        const current = await getA2AInboundProfile(profile.id);
        if (!current) throw new Error("A2A authorization revoked");
        return scopeRank(current.scope) < scopeRank(profile.scope) ? current.scope : profile.scope;
      },
      onDelta(chunk) {
        if (controller.signal.aborted) return;
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
  signal?: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: () => void = () => {};
  let close: () => void = () => {};
  const release = registerA2AStream(profile.id, () => close());
  if (!release) return new Response(JSON.stringify({error:"stream_limit"}), {status:429,headers:{"content-type":"application/json","retry-after":"60"}});
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const timer = setTimeout(()=>close(),5*60_000);
      timer.unref?.();
      close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        unsubscribe();
        release();
        signal?.removeEventListener("abort",close);
        try { controller.close(); } catch { /* Disconnected client. */ }
      };
      signal?.addEventListener("abort",close,{once:true});
      if (signal?.aborted) { close(); return; }
      const emit = (result: A2AStreamResponse) => {
        if (closed) return;
        try {
          if (controller.desiredSize !== null && controller.desiredSize <= 0) { close(); return; }
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(a2aRpcOk(id, result))}\n\n`),
          );
        } catch { close(); }
        const status = (result.statusUpdate as {status?:{state?:string}} | undefined)?.status ?? (result.task as {status?:{state?:string}} | undefined)?.status;
        if (status && A2A_TERMINAL_STATES.has(String(status.state))) close();
      };
      try {
        if (!profile.local && !await getA2AInboundProfile(profile.id)) { close(); return; }
        if (closed) return;
        unsubscribe = subscribeA2AEvent(task.id,emit);
        const current = await getA2ATaskForPrincipal(task.id,task.principal,10);
        if (closed) return;
        if (!current) { close(); return; }
        emit({task:current});
      } catch { close(); return; }
      if (closed) return;
      if (prompt !== undefined) {
        void executeInboundA2ATask(task, profile, prompt, session, capabilities).finally(
          () => close(),
        );
      }
    },
    cancel() {
      close(); // Task intentionally continues independently of this stream.
    },
  }, {highWaterMark:16});
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}

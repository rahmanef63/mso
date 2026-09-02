import { NextRequest, NextResponse } from "next/server";
import {
  cancelA2ATask,
  handoffA2A,
  handoffA2ALocalSession,
  spawnA2ALocalSubagent,
  resolveA2AAgent,
  sendA2AMessage,
  sendA2AStreamingMessage,
} from "@/lib/a2a";
import { audit } from "@/lib/host";
import { a2aHash, a2aLimited } from "./route-shared";

export async function handleA2AMessageAction(
  req: NextRequest,
  action: string,
  body: Record<string, unknown>,
  actor: string,
  target: string,
  ownerPrincipal: string,
): Promise<NextResponse | null> {
  if (action === "local-handoff") {
    if (a2aLimited(actor, action, 30))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const sessionRef =
      typeof body.sessionRef === "string" ? body.sessionRef.trim() : target;
    const objective = typeof body.objective === "string" ? body.objective : "";
    if (!sessionRef || !objective)
      return NextResponse.json(
        { error: "session_and_objective_required" },
        { status: 400 },
      );
    const result = await handoffA2ALocalSession(sessionRef, objective);
    void audit({
      action: "a2a.send",
      actor,
      target: result.session.id,
      detail: "local-session.handoff",
    });
    return NextResponse.json(result);
  }
  if (action === "local-spawn") {
    if (a2aLimited(actor, action, 20))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const sourceSessionRef =
      typeof body.sourceSessionRef === "string"
        ? body.sourceSessionRef.trim()
        : "";
    const objective = typeof body.objective === "string" ? body.objective : "";
    if (!sourceSessionRef || !objective)
      return NextResponse.json(
        { error: "source_session_and_objective_required" },
        { status: 400 },
      );
    const result = await spawnA2ALocalSubagent({
      ownerPrincipal,
      sourceSessionRef,
      objective,
      title: typeof body.title === "string" ? body.title : undefined,
    });
    void audit({
      action: "a2a.send",
      actor,
      target: result.session.id,
      detail: "local-session.spawn",
    });
    return NextResponse.json(result);
  }
  if (action === "stream") {
    if (a2aLimited(actor, action, 20))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const message = typeof body.message === "string" ? body.message : "";
    if (!target || !message)
      return NextResponse.json(
        { error: "target_and_message_required" },
        { status: 400 },
      );
    const peer = await resolveA2AAgent(target);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of sendA2AStreamingMessage(peer, message, {
            signal: req.signal,
          })) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          }
        } catch (error) {
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify(error instanceof Error ? error.message : String(error))}\n\n`,
            ),
          );
        } finally {
          try {
            controller.close();
          } catch {
            // Owner disconnected from the proxy stream.
          }
        }
      },
    });
    void audit({ action: "a2a.send", actor, target, detail: "message.stream" });
    return new NextResponse(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  }
  if (action === "send") {
    if (a2aLimited(actor, action, 30))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const message = typeof body.message === "string" ? body.message : "";
    if (!target || !message)
      return NextResponse.json(
        { error: "target_and_message_required" },
        { status: 400 },
      );
    const response = await sendA2AMessage(
      await resolveA2AAgent(target),
      message,
      {
        contextId:
          typeof body.contextId === "string" ? body.contextId : undefined,
        taskId: typeof body.taskId === "string" ? body.taskId : undefined,
        returnImmediately: body.returnImmediately !== false,
      },
    );
    void audit({ action: "a2a.send", actor, target, detail: "message.send" });
    return NextResponse.json({ response });
  }
  if (action === "cancel") {
    if (a2aLimited(actor, action, 30))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    if (!target || !taskId)
      return NextResponse.json(
        { error: "target_and_taskId_required" },
        { status: 400 },
      );
    const response = await cancelA2ATask(await resolveA2AAgent(target), taskId);
    void audit({
      action: "a2a.cancel",
      actor,
      target: taskId,
      detail: `target=${target.slice(0, 120)}`,
    });
    return NextResponse.json({ response });
  }
  if (action === "handoff") {
    if (a2aLimited(actor, action, 30))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const objective = typeof body.objective === "string" ? body.objective : "";
    if (!target || !objective)
      return NextResponse.json(
        { error: "target_and_objective_required" },
        { status: 400 },
      );
    const result = await handoffA2A(
      await resolveA2AAgent(target),
      objective,
      typeof body.context === "string" ? body.context : undefined,
      {
        returnImmediately: body.returnImmediately !== false,
        sourceSessionHash: a2aHash(`cli:${actor}`),
      },
    );
    void audit({ action: "a2a.send", actor, target, detail: "handoff" });
    return NextResponse.json(result);
  }
  return null;
}

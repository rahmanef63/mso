import { NextRequest, NextResponse } from "next/server";
import {
  discoverA2AAgent,
  getA2ATask,
  listA2AAgents,
  listA2AInboundTokens,
  listA2AOutboundCredentials,
  listA2ATasksOwner,
  listA2ALocalSessions,
  resolveA2ALocalSession,
  resolveA2AAgent,
} from "@/lib/a2a";
import { a2aInboundConfig } from "@/lib/a2a/inbound-config";
import { readAuditTail } from "@/lib/host/audit-api";
import { a2aLimited } from "./route-shared";

export async function handleA2AGet(req: NextRequest, actor: string) {
  const action = req.nextUrl.searchParams.get("action") || "list";
  if (action === "list")
    return NextResponse.json({ agents: await listA2AAgents() });
  if (action === "state") {
    const [agents, credentials, inboundTokens, tasks, activity] =
      await Promise.all([
        listA2AAgents(),
        listA2AOutboundCredentials(),
        listA2AInboundTokens(),
        listA2ATasksOwner(50),
        readAuditTail({ prefix: "a2a.", limit: 50 }),
      ]);
    return NextResponse.json({
      inbound: a2aInboundConfig(),
      agents,
      credentials,
      inboundTokens,
      tasks,
      activity,
    });
  }
  if (action === "local-sessions") {
    return NextResponse.json({ sessions: await listA2ALocalSessions(200) });
  }
  if (action === "local-inbox") {
    const ref = req.nextUrl.searchParams.get("session") || "";
    if (!ref)
      return NextResponse.json({ error: "session_required" }, { status: 400 });
    const session = await resolveA2ALocalSession(ref);
    const tasks = (await listA2ATasksOwner(100)).filter(
      (task) => task.targetSessionId === session.id,
    );
    return NextResponse.json({ session, tasks });
  }
  if (action === "credentials") {
    const agentId = req.nextUrl.searchParams.get("agentId") || undefined;
    return NextResponse.json({
      credentials: await listA2AOutboundCredentials(agentId),
      inboundTokens: await listA2AInboundTokens(),
    });
  }
  if (action === "activity") {
    return NextResponse.json({
      activity: await readAuditTail({ prefix: "a2a.", limit: 100 }),
    });
  }
  if (action === "discover") {
    if (a2aLimited(actor, action, 20))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const url = req.nextUrl.searchParams.get("url") || "";
    return url
      ? NextResponse.json(await discoverA2AAgent(url))
      : NextResponse.json({ error: "url_required" }, { status: 400 });
  }
  if (action === "task") {
    if (a2aLimited(actor, action, 60))
      return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
    const target = req.nextUrl.searchParams.get("target") || "";
    const taskId = req.nextUrl.searchParams.get("taskId") || "";
    const historyLength = Math.max(
      0,
      Math.min(
        100,
        Number(req.nextUrl.searchParams.get("historyLength")) || 10,
      ),
    );
    if (!target || !taskId)
      return NextResponse.json(
        { error: "target_and_taskId_required" },
        { status: 400 },
      );
    return NextResponse.json(
      await getA2ATask(await resolveA2AAgent(target), taskId, historyLength),
    );
  }
  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cancelA2ATask, discoverA2AAgent, getA2ATask, handoffA2A, listA2AAgents, registerA2AAgent, removeA2AAgent, resolveA2AAgent, sendA2AMessage } from "@/lib/a2a";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit, rateLimited, readJson } from "@/lib/host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerContext() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}
function error(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "A2A operation failed";
  const status = /not found/i.test(message) ? 404 : /ambiguous/i.test(message) ? 409 : 400;
  return NextResponse.json({ error: message.slice(0, 240) }, { status });
}
function hash(value?: string): string | undefined {
  return value ? createHash("sha256").update(value).digest("hex").slice(0, 24) : undefined;
}
function limited(actor: string, action: string, max: number): boolean {
  return rateLimited(`a2a:${action}:${actor}`, max, 60_000);
}

export async function GET(req: NextRequest) {
  const context = await ownerContext(); if (!context) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const action = req.nextUrl.searchParams.get("action") || "list"; const actor = context.session.device_id || "owner";
  try {
    if (action === "list") return NextResponse.json({ agents: await listA2AAgents() });
    if (action === "discover") {
      if (limited(actor, action, 20)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const url = req.nextUrl.searchParams.get("url") || ""; if (!url) return NextResponse.json({ error: "url_required" }, { status: 400 });
      return NextResponse.json(await discoverA2AAgent(url));
    }
    if (action === "task") {
      if (limited(actor, action, 60)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const target = req.nextUrl.searchParams.get("target") || ""; const taskId = req.nextUrl.searchParams.get("taskId") || "";
      const historyLength = Math.max(0, Math.min(100, Number(req.nextUrl.searchParams.get("historyLength")) || 10));
      if (!target || !taskId) return NextResponse.json({ error: "target_and_taskId_required" }, { status: 400 });
      return NextResponse.json(await getA2ATask(await resolveA2AAgent(target), taskId, historyLength));
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) { return error(e); }
}

export async function POST(req: NextRequest) {
  const context = await ownerContext(); if (!context) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const actor = context.session.device_id || "owner"; const body = await readJson(req) as Record<string, unknown> | null; const action = String(body?.action || "");
  const target = typeof body?.target === "string" ? body.target : "";
  try {
    if (action === "register") {
      if (limited(actor, action, 20)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const url = typeof body?.url === "string" ? body.url : ""; if (!url) return NextResponse.json({ error: "url_required" }, { status: 400 });
      const agent = await registerA2AAgent(url, typeof body?.alias === "string" ? body.alias : undefined);
      void audit({ action: "a2a.registry", actor, target: url, ok: true, detail: "agent.register" }); return NextResponse.json({ agent });
    }
    if (action === "remove") {
      if (limited(actor, action, 20)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 }); if (!target) return NextResponse.json({ error: "target_required" }, { status: 400 });
      const ok = await removeA2AAgent(target); void audit({ action: "a2a.registry", actor, target, ok, detail: "agent.remove" }); return NextResponse.json({ ok });
    }
    if (action === "send") {
      if (limited(actor, action, 30)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const message = typeof body?.message === "string" ? body.message : ""; if (!target || !message) return NextResponse.json({ error: "target_and_message_required" }, { status: 400 });
      const response = await sendA2AMessage(await resolveA2AAgent(target), message, { contextId: typeof body?.contextId === "string" ? body.contextId : undefined, taskId: typeof body?.taskId === "string" ? body.taskId : undefined, returnImmediately: body?.returnImmediately !== false });
      void audit({ action: "a2a.send", actor, target, ok: true, detail: "message.send" }); return NextResponse.json({ response });
    }
    if (action === "cancel") {
      if (limited(actor, action, 30)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const taskId = typeof body?.taskId === "string" ? body.taskId : ""; if (!target || !taskId) return NextResponse.json({ error: "target_and_taskId_required" }, { status: 400 });
      const response = await cancelA2ATask(await resolveA2AAgent(target), taskId); void audit({ action: "a2a.cancel", actor, target: taskId, ok: true, detail: `target=${target.slice(0, 120)}` }); return NextResponse.json({ response });
    }
    if (action === "handoff") {
      if (limited(actor, action, 30)) return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
      const objective = typeof body?.objective === "string" ? body.objective : ""; if (!target || !objective) return NextResponse.json({ error: "target_and_objective_required" }, { status: 400 });
      const result = await handoffA2A(await resolveA2AAgent(target), objective, typeof body?.context === "string" ? body.context : undefined, { returnImmediately: body?.returnImmediately !== false, sourceSessionHash: hash(`cli:${actor}`) });
      void audit({ action: "a2a.send", actor, target, ok: true, detail: "handoff" }); return NextResponse.json(result);
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    if (action === "register" || action === "remove") void audit({ action: "a2a.registry", actor, target: target || String(body?.url || ""), ok: false, detail: String((e as Error).message).slice(0, 160) });
    else if (action === "cancel") void audit({ action: "a2a.cancel", actor, target, ok: false, detail: String((e as Error).message).slice(0, 160) });
    else if (action === "send" || action === "handoff") void audit({ action: "a2a.send", actor, target, ok: false, detail: String((e as Error).message).slice(0, 160) });
    return error(e);
  }
}

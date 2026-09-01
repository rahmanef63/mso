import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { createAgentSession, renameAgentSession, updateAgentSessionHistory } from "@/lib/agent/session-store";
import { pruneAgentSessionArchives } from "@/lib/agent/session-archive";
import { ownerSessionSummaries, resolveAgentSessionOwnerRef, resumeAgentSessionForOwner } from "@/lib/agent/session-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerPrincipal(): Promise<string | null> {
  const context = await getSessionContext();
  return context?.role === "owner" ? `cli:${context.session.device_id}` : null;
}

function error(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "agent session failed";
  const status = message.includes("not_found") || message.includes("not found") ? 404 : message.includes("ambiguous") ? 409 : 400;
  return NextResponse.json({ error: message.slice(0, 240) }, { status });
}

export async function GET(req: NextRequest) {
  const principal = await ownerPrincipal();
  if (!principal) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const ref = (req.nextUrl.searchParams.get("ref") || req.nextUrl.searchParams.get("id") || "").trim();
  if (ref) {
    try { return NextResponse.json({ session: await resolveAgentSessionOwnerRef(ref) }); }
    catch (e) { return error(e); }
  }
  const limit = Math.max(1, Math.min(200, Number(req.nextUrl.searchParams.get("limit")) || 30));
  return NextResponse.json({ sessions: await ownerSessionSummaries(limit) });
}

export async function POST(req: NextRequest) {
  const principal = await ownerPrincipal();
  if (!principal) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  let body: { action?: string; id?: string; ref?: string; title?: string; history?: unknown[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  try {
    if (body.action === "create") {
      return NextResponse.json({ session: await createAgentSession(principal, "cli", { title: body.title, titleSource: body.title ? "manual" : "default" }) });
    }
    if (body.action === "update") {
      if (!body.id || !Array.isArray(body.history)) return NextResponse.json({ error: "id_and_history_required" }, { status: 400 });
      return NextResponse.json({ session: await updateAgentSessionHistory(principal, body.id, body.history, body.title, "auto") });
    }
    if (body.action === "resume") {
      const ref = String(body.ref || body.id || "").trim();
      if (!ref) return NextResponse.json({ error: "session_reference_required" }, { status: 400 });
      return NextResponse.json({ session: await resumeAgentSessionForOwner(principal, ref) });
    }
    if (body.action === "rename") {
      if (!body.id || !body.title) return NextResponse.json({ error: "id_and_title_required" }, { status: 400 });
      return NextResponse.json({ session: await renameAgentSession(principal, body.id, body.title) });
    }
    if (body.action === "prune-archives") return NextResponse.json(await pruneAgentSessionArchives());
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) { return error(e); }
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import {
  agentSessionSummary,
  createAgentSession,
  getAgentSession,
  listAgentSessions,
  updateAgentSessionHistory,
} from "@/lib/agent/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerPrincipal(): Promise<string | null> {
  const context = await getSessionContext();
  return context?.role === "owner" ? `cli:${context.session.device_id}` : null;
}

export async function GET(req: NextRequest) {
  const principal = await ownerPrincipal();
  if (!principal) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (id) {
    try {
      const session = await getAgentSession(principal, id);
      if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
      return NextResponse.json({ session });
    } catch {
      return NextResponse.json({ error: "invalid_session_id" }, { status: 400 });
    }
  }
  const limit = Math.max(1, Math.min(100, Number(req.nextUrl.searchParams.get("limit")) || 30));
  return NextResponse.json({ sessions: await listAgentSessions(principal, limit) });
}

export async function POST(req: NextRequest) {
  const principal = await ownerPrincipal();
  if (!principal) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  let body: { action?: string; id?: string; title?: string; history?: unknown[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }

  try {
    if (body.action === "create") {
      const session = await createAgentSession(principal, "cli", { title: body.title });
      return NextResponse.json({ session });
    }
    if (body.action === "update") {
      if (!body.id || !Array.isArray(body.history)) return NextResponse.json({ error: "id_and_history_required" }, { status: 400 });
      const session = await updateAgentSessionHistory(principal, body.id, body.history, body.title);
      return NextResponse.json({ session: agentSessionSummary(session) });
    }
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "agent session failed";
    if (message.includes("not found")) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 400 });
  }
}

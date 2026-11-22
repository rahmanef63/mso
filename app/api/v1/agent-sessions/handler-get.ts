import { NextRequest, NextResponse } from "next/server";
import { ownerSessionPage, ownerSessionDetail, ownerSessionGraph } from "@/lib/agent/session-monitor";
import type { AgentSession } from "@/lib/agent/session-types";
import { artifactLocation } from "@/lib/agent/artifact-paths";
import { getSessionContext } from "@/lib/auth/require-session";
import { resolveHistoricalSessionArtifactForOwner } from "@/lib/agent/session-artifact-resolver";
import { jevPreservationStatus } from "@/lib/agent/session-jev-preservation";
import {
  ownerSessionSummaries,
  resolveAgentSessionOwnerRef,
} from "@/lib/agent/session-query";

function sessionResponse({ session }: { session: AgentSession }) {
  return NextResponse.json({ session: { ...session, artifacts: artifactLocation(session) } });
}

async function ownerPrincipal(): Promise<string | null> {
  const context = await getSessionContext();
  return context?.role === "owner" ? `cli:${context.session.device_id}` : null;
}

function error(cause: unknown): NextResponse {
  const message = cause instanceof Error ? cause.message : "agent session failed";
  const status =
    message.includes("not_found") || message.includes("not found")
      ? 404
      : message.includes("ambiguous")
        ? 409
        : 400;
  return NextResponse.json({ error: message.slice(0, 240) }, { status });
}

export async function handleGetAgentSessions(req: NextRequest) {
  const principal = await ownerPrincipal();
  if (!principal)
    return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const view = req.nextUrl.searchParams.get("view");
  if (view === "artifact") {
    try {
      const ref = String(req.nextUrl.searchParams.get("id") || req.nextUrl.searchParams.get("ref") || "").trim();
      const actionRef = String(req.nextUrl.searchParams.get("action_ref") || "").trim();
      if (!ref || !actionRef) return NextResponse.json({ error: "session_and_action_reference_required" }, { status: 400 });
      const source = await resolveAgentSessionOwnerRef(ref);
      const result = await resolveHistoricalSessionArtifactForOwner(source, actionRef);
      if (!result?.artifact) return NextResponse.json({ error: "artifact_revision_not_found" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
      return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
    } catch (cause) {
      const missing = cause instanceof Error && cause.message === "session_not_found";
      return NextResponse.json({ error: missing ? "session_not_found" : "artifact_revision_unavailable" }, { status: missing ? 404 : 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  if (view === "jev-preservation") {
    try { return NextResponse.json(await jevPreservationStatus(), { headers: { "Cache-Control": "private, no-store" } }); }
    catch (cause) { return error(cause); }
  }
  if (view === "monitor" || view === "graph") {
    try {
      const id = req.nextUrl.searchParams.get("id");
      const page = Number(req.nextUrl.searchParams.get("page") || 1);
      const result = view === "graph"
        ? (id ? await ownerSessionGraph(id, Number(req.nextUrl.searchParams.get("limit") || 120)) : null)
        : (id ? await ownerSessionDetail(id, page) : await ownerSessionPage(page, req.nextUrl.searchParams.get("includeOffline") === "1", req.nextUrl.searchParams.get("q") || ""));
      return NextResponse.json(result || { error: "session_not_found" }, { status: result ? 200 : 404, headers: { "Cache-Control": "private, no-store" } });
    } catch (cause) {
      const invalid = cause instanceof Error && ["invalid_session_id", "session search exceeds 200 characters"].includes(cause.message);
      return NextResponse.json({ error: invalid ? "invalid_monitor_query" : "session_monitor_unavailable" }, { status: invalid ? 400 : 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  const ref = (
    req.nextUrl.searchParams.get("ref") ||
    req.nextUrl.searchParams.get("id") ||
    ""
  ).trim();
  if (ref) {
    try {
      return sessionResponse({
        session: await resolveAgentSessionOwnerRef(ref),
      });
    } catch (e) {
      return error(e);
    }
  }
  const limit = Math.max(
    1,
    Math.min(200, Number(req.nextUrl.searchParams.get("limit")) || 30),
  );
  return NextResponse.json({ sessions: await ownerSessionSummaries(limit) });
}

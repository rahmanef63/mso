import { NextRequest, NextResponse } from "next/server";
import { ownerSessionGraph } from "@/lib/agent/session-monitor";
import type { AgentSession } from "@/lib/agent/session-types";
import { artifactLocation } from "@/lib/agent/artifact-paths";
import { getSessionContext } from "@/lib/auth/require-session";
import {
  createAgentSession,
  renameAgentSession,
  renameAgentSessionName,
  updateAgentSessionHistory,
  updateAgentSessionLocation,
} from "@/lib/agent/session-store";
import { compactAgentSessionRouteHandler } from "@/lib/agent/session-compact-now";
import { pruneAgentSessionArchives } from "@/lib/agent/session-archive";
import { sessionWorkflowDraftDefinition } from "@/lib/agent/session-workflow-draft";
import { createWorkflowGraph } from "@/lib/workflow/graph-store";
import { optimizeSessionWithJev } from "@/lib/workflow/jev-session-optimizer";
import { optimizeSessionPreservationBatch } from "@/lib/agent/session-jev-preservation";
import {
  resolveAgentSessionOwnerRef,
  resumeAgentSessionForOwner,
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

export async function handlePostAgentSessions(req: NextRequest) {
  const principal = await ownerPrincipal();
  if (!principal)
    return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  let body: {
    action?: string;
    id?: string;
    ref?: string;
    name?: string;
    title?: string;
    history?: unknown[];
    cwd?: string;
    parentSessionId?: string;
    step_ref?: string;
    jev?: unknown;
    cursor?: number;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  try {
    if (body.action === "create") {
      return sessionResponse({
        session: await createAgentSession(principal, "cli", {
          title: body.title,
          titleSource: body.title ? "manual" : "default",
          cwd: body.cwd,
          parentSessionId: body.parentSessionId,
        }),
      });
    }
    if (body.action === "update") {
      if (!body.id || !Array.isArray(body.history))
        return NextResponse.json(
          { error: "id_and_history_required" },
          { status: 400 },
        );
      const session = await updateAgentSessionHistory(
        principal,
        body.id,
        body.history,
        body.title,
        "auto",
      );
      return sessionResponse({
        session: body.cwd
          ? await updateAgentSessionLocation(principal, session.id, body.cwd)
          : session,
      });
    }
    if (body.action === "resume") {
      const ref = String(body.ref || body.id || "").trim();
      if (!ref)
        return NextResponse.json(
          { error: "session_reference_required" },
          { status: 400 },
        );
      return sessionResponse({
        session: await resumeAgentSessionForOwner(principal, ref, body.cwd),
      });
    }
    if (body.action === "rename-name") {
      if (!body.id || !body.name)
        return NextResponse.json(
          { error: "id_and_name_required" },
          { status: 400 },
        );
      return sessionResponse({
        session: await renameAgentSessionName(principal, body.id, body.name),
      });
    }
    if (body.action === "rename") {
      if (!body.id || !body.title)
        return NextResponse.json(
          { error: "id_and_title_required" },
          { status: 400 },
        );
      return sessionResponse({
        session: await renameAgentSession(principal, body.id, body.title),
      });
    }
    if (body.action === "optimize-with-jev") {
      const ref = String(body.ref || body.id || "").trim();
      if (!ref) return NextResponse.json({ error: "session_reference_required" }, { status: 400 });
      const source = await resolveAgentSessionOwnerRef(ref);
      const view = await ownerSessionGraph(source.id, 120);
      if (!view) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
      return NextResponse.json({ optimization: await optimizeSessionWithJev(view, body.jev) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.action === "optimize-all-with-jev") {
      return NextResponse.json(await optimizeSessionPreservationBatch({ cursor: body.cursor, limit: body.limit }), { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.action === "save-workflow-draft") {
      const ref = String(body.ref || body.id || "").trim();
      if (!ref) return NextResponse.json({ error: "session_reference_required" }, { status: 400 });
      const source = await resolveAgentSessionOwnerRef(ref);
      const context = await getSessionContext();
      if (!context?.session.device_id || context.role !== "owner") return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
      const definition = sessionWorkflowDraftDefinition(source, body.step_ref);
      const graph = await createWorkflowGraph(`web:${context.session.device_id}`, definition, "create", { remember: true });
      return NextResponse.json({ graph }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (body.action === "compact") return await compactAgentSessionRouteHandler(principal, body.id || body.ref);
    if (body.action === "prune-archives")
      return NextResponse.json(await pruneAgentSessionArchives());
    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (e) {
    return error(e);
  }
}

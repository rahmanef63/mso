import { NextRequest, NextResponse } from "next/server";
import { matchesAgentApproval } from "@/lib/agent/approval.mjs";
import { getAgentSession } from "@/lib/agent/session-store";
import { getSessionContext } from "@/lib/auth/require-session";
import { dispatch } from "@/lib/mcp/dispatch";
import { maxScope, allows } from "@/lib/mcp/scope";
import { TOOLS } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerContext() {
  const context = await getSessionContext();
  return context?.role === "owner" ? context : null;
}

export async function GET() {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const scope = maxScope();
  const listed = await dispatch({ id: "cli-list", method: "tools/list" }, scope, `cli:${context.session.device_id}`);
  const result = (listed.result ?? {}) as { tools?: Array<Record<string, unknown>>; _meta?: unknown };
  const tools = (result.tools ?? []).map((tool) => {
    const name = String(tool.name ?? "");
    const def = TOOLS.find((entry) => entry.name === name);
    return { ...tool, scope: def?.scope ?? "read", approvalRequired: def ? def.scope !== "read" : false };
  });
  return NextResponse.json({ scope, tools, _meta: result._meta });
}

export async function POST(req: NextRequest) {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  let body: { name?: string; input?: Record<string, unknown>; approved?: boolean; approvalDigest?: string; sessionId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
  const name = String(body.name ?? "");
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) return NextResponse.json({ error: `unknown tool: ${name}` }, { status: 404 });
  const principal = `cli:${context.session.device_id}`;
  const sessionId = String(body.sessionId ?? "").trim();
  if (!sessionId) return NextResponse.json({ error: "agent_session_required" }, { status: 400 });
  let agentSession;
  try { agentSession = await getAgentSession(principal, sessionId); }
  catch { return NextResponse.json({ error: "invalid_agent_session" }, { status: 400 }); }
  if (!agentSession || agentSession.source !== "cli") {
    return NextResponse.json({ error: "agent_session_not_found" }, { status: 404 });
  }
  const scope = maxScope();
  if (!allows(scope, tool.scope)) return NextResponse.json({ error: `deployment scope ${scope} does not allow ${tool.scope}` }, { status: 403 });
  if (tool.scope !== "read") {
    if (body.approved !== true) return NextResponse.json({ error: "explicit_agent_approval_required", tool: name, scope: tool.scope }, { status: 409 });
    if (!matchesAgentApproval(name, body.input ?? {}, body.approvalDigest)) {
      return NextResponse.json({ error: "agent_approval_payload_mismatch", tool: name, scope: tool.scope }, { status: 409 });
    }
  }
  const rpc = await dispatch(
    { id: "cli-call", method: "tools/call", params: { name, arguments: body.input ?? {} } },
    scope,
    principal,
    { principal, sessionId },
  );
  const result = (rpc.result ?? {}) as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  if ((rpc as { error?: unknown }).error) return NextResponse.json(rpc, { status: 400 });
  const text = (result.content ?? []).filter((row) => row.type === "text").map((row) => row.text ?? "").join("\n");
  return NextResponse.json({ ok: !result.isError, result: text || JSON.stringify(result.content ?? []), isError: Boolean(result.isError) });
}

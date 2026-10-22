import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { readRequestJson, RequestBodyError } from "@/lib/security/request-body";
import { redactText } from "@/lib/security/redact-text";
import { rateLimited } from "@/lib/host/limits-api";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";
import { SelectedModelConfigError } from "@/lib/ai/selected-model-stream";
import { AgentProfileError } from "@/lib/agent/profile-schema";
import { AcpError } from "@/lib/agent/acp-client";
import { runAgentProfile } from "@/lib/agent/profile-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const active = new Set<string>();
const headers = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(req: Request) {
  const context = await getSessionContext();
  if (!context) return fail("unauthorized", 401);
  if (context.role !== "owner") return fail("profile_owner_required", 403);
  const device = context.session.device_id;
  if (!device) return fail("unauthorized", 401);
  let admitted = false;
  try {
    const body = await readRequestJson(req, 16 * 1024);
    if (rateLimited(`profile-run:${device}`, 10, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    if (active.has(device)) return fail("profile_run_already_active", 409);
    active.add(device); admitted = true;
    const result = await runAgentProfile({ session: context.session, body, capabilities: msoCapabilityRuntime, signal: req.signal });
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof AcpError) return fail(redactText(error.message, 300), error.status);
    if (error instanceof AgentProfileError || error instanceof RequestBodyError || error instanceof SelectedModelConfigError) return fail(error.message, error.status);
    return fail(req.signal.aborted ? "profile_run_cancelled" : "profile_run_failed", req.signal.aborted ? 499 : 502);
  } finally { if (admitted) active.delete(device); }
}

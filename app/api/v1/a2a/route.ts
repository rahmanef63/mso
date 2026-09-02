import { NextRequest, NextResponse } from "next/server";
import { readJson } from "@/lib/host";
import { handleA2ACredentialAction } from "./route-credentials";
import { handleA2AGet } from "./route-get";
import { handleA2AMessageAction } from "./route-messages";
import {
  a2aOwnerContext,
  a2aRouteError,
  auditA2AFailure,
} from "./route-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const context = await a2aOwnerContext();
  if (!context)
    return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  try {
    return await handleA2AGet(req, context.session.device_id || "owner");
  } catch (error) {
    return a2aRouteError(error);
  }
}

export async function POST(req: NextRequest) {
  const context = await a2aOwnerContext();
  if (!context)
    return NextResponse.json({ error: "owner_role_required" }, { status: 403 });
  const actor = context.session.device_id || "owner";
  const body = (await readJson(req)) as Record<string, unknown> | null;
  const action = String(body?.action || "");
  const target = typeof body?.target === "string" ? body.target : "";
  try {
    if (!body)
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const credential = await handleA2ACredentialAction(
      action,
      body,
      actor,
      target,
    );
    if (credential) return credential;
    const message = await handleA2AMessageAction(
      req,
      action,
      body,
      actor,
      target,
      `cli:${context.session.device_id}`,
    );
    return (
      message ?? NextResponse.json({ error: "unknown_action" }, { status: 400 })
    );
  } catch (error) {
    auditA2AFailure(action, actor, target, body, error);
    return a2aRouteError(error);
  }
}

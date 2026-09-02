import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { IS_DEMO } from "@/lib/demo";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { getManagedApp, performManagedAppAction } from "@/lib/managed-apps/manager";
import { MANAGED_APP_ACTIONS, type ManagedAppAction } from "@/lib/managed-apps/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  return NextResponse.json({ app: await getManagedApp(id) });
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (IS_DEMO) return NextResponse.json({ error: "managed application actions are disabled in demo mode" }, { status: 403 });
  const { id } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  if (rateLimited(`managed-app:${id}`, 12, 60_000)) return NextResponse.json({ error: "too many operations" }, { status: 429 });
  let body: { action?: unknown };
  try { body = await req.json() as { action?: unknown }; }
  catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  if (typeof body.action !== "string" || !(MANAGED_APP_ACTIONS as readonly string[]).includes(body.action)) {
    return NextResponse.json({ error: "unsupported managed application action" }, { status: 400 });
  }
  const action = body.action as ManagedAppAction;
  // `actor` is the approved device behind the session — the same attribution
  // every fs route records. Without it, stop/restart/backup of the operator's
  // agents were the only privileged actions in the product the trail could not
  // answer "by whom" for.
  const actor = await getSessionActor();
  try {
    const app = await performManagedAppAction(id, action);
    await audit({ action: "managed-app.action", target: id, actor, ok: true, detail: action });
    return NextResponse.json({ app });
  } catch {
    await audit({ action: "managed-app.action", target: id, actor, ok: false, detail: action });
    return NextResponse.json({ error: "managed application operation failed" }, { status: 409 });
  }
}

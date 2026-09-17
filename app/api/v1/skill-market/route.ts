import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { readSetupJson } from "@/lib/infra/setup-http";
import { listSkillMarket, manageSkillMarket } from "@/lib/host/skill-market-api";
import { audit } from "@/lib/host/audit-api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private" };
export async function GET() {
  if (IS_DEMO || (await getSessionContext())?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  try { return NextResponse.json(await listSkillMarket(), { headers }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Skill catalog failed" }, { status: 400, headers }); }
}
export async function POST(req: NextRequest) {
  const auth = await getSessionContext();
  if (IS_DEMO || auth?.role !== "owner") return NextResponse.json({ error: "owner_required" }, { status: 403, headers });
  let target = "skill-market";
  try {
    const args = await readSetupJson(req);
    if ((args.action !== "install" && args.action !== "remove") || typeof args.id !== "string" || typeof args.revision !== "string") throw new Error("action, id and revision required");
    target = args.id;
    const result = await manageSkillMarket({ action: args.action, id: args.id, revision: args.revision });
    await audit({ action: args.action === "remove" ? "fs.delete" : "fs.write", actor: auth.session.device_id, target, ok: true, meta: { via: "skill-market", operation: args.action } });
    return NextResponse.json(result, { headers });
  } catch (error) {
    await audit({ action: "fs.write", actor: auth.session.device_id, target, ok: false, meta: { via: "skill-market" } });
    return NextResponse.json({ error: error instanceof Error ? error.message.slice(0, 300) : "Skill operation failed" }, { status: 400, headers });
  }
}

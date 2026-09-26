import { NextRequest, NextResponse } from "next/server";
import { AccountProfileError, readAccountProfile, writeAccountProfile } from "@/lib/auth/account-profile";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { IS_DEMO } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (IS_DEMO) return NextResponse.json({ error: "demo" }, { status: 403, headers: noStore });
  if (!(await getSessionContext())) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: noStore });
  try {
    return NextResponse.json(await readAccountProfile(), { headers: noStore });
  } catch (error) {
    const code = error instanceof AccountProfileError ? error.code : "corrupt";
    return NextResponse.json({ error: code }, { status: 500, headers: noStore });
  }
}

export async function POST(req: NextRequest) {
  if (IS_DEMO) return NextResponse.json({ error: "demo" }, { status: 403, headers: noStore });
  const context = await getSessionContext();
  if (!context || context.role !== "owner") {
    return NextResponse.json({ error: "owner_required" }, { status: 403, headers: noStore });
  }
  let body: { name?: unknown; icon?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }
  if (body.name === undefined && body.icon === undefined) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }
  try {
    const profile = await writeAccountProfile({ name: body.name, icon: body.icon });
    await audit({
      action: "auth.account",
      actor: context.session.device_id,
      ok: true,
      detail: body.name !== undefined && body.icon !== undefined ? "name,icon" : body.icon !== undefined ? "icon" : "name",
    });
    return NextResponse.json(profile, { headers: noStore });
  } catch (error) {
    const code = error instanceof AccountProfileError ? error.code : "invalid";
    const status = code === "corrupt" ? 500 : 400;
    return NextResponse.json({ error: code }, { status, headers: noStore });
  }
}

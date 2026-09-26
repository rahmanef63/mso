import { NextRequest, NextResponse } from "next/server";
import { LoginPasswordError, rotateLoginPassword, type LoginPasswordCode } from "@/lib/auth/login-password";
import { getSessionContext } from "@/lib/auth/require-session";
import { audit } from "@/lib/host/audit-api";
import { IS_DEMO } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

const STATUS: Record<LoginPasswordCode, number> = {
  bad_current: 401,
  rate_limited: 429,
  password_source_mismatch: 409,
  password_file_unsafe: 409,
  not_configured: 500,
  mismatch: 400,
  weak_password: 400,
  unchanged: 400,
};

export async function POST(req: NextRequest) {
  if (IS_DEMO) return NextResponse.json({ error: "demo" }, { status: 403, headers: noStore });
  const context = await getSessionContext();
  if (!context || context.role !== "owner") {
    return NextResponse.json({ error: "owner_required" }, { status: 403, headers: noStore });
  }
  let body: { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }
  if (typeof body.currentPassword !== "string" || typeof body.newPassword !== "string" || typeof body.confirmPassword !== "string") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: noStore });
  }
  try {
    await rotateLoginPassword({
      current: body.currentPassword,
      next: body.newPassword,
      confirm: body.confirmPassword,
      actor: context.session.device_id ?? "owner",
    });
  } catch (error) {
    const code: LoginPasswordCode = error instanceof LoginPasswordError ? error.code : "password_file_unsafe";
    if (code === "bad_current" || code === "rate_limited") {
      await audit({ action: "auth.password", actor: context.session.device_id, ok: false, detail: code });
    }
    return NextResponse.json({ error: code }, { status: STATUS[code], headers: noStore });
  }
  await audit({ action: "auth.password", actor: context.session.device_id, ok: true, detail: "rotated" });
  return NextResponse.json({ ok: true }, { headers: noStore });
}

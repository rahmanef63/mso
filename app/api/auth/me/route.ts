import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight live authorization probe. Role is resolved from the device store on
// every request, never trusted from a long-lived cookie.
export async function GET() {
  const context = await getSessionContext();
  return NextResponse.json({
    authenticated: context !== null,
    deviceId: context?.session.device_id ?? null,
    deviceLabel: context?.device.label ?? null,
    role: context?.role ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}

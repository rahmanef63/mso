import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";

export async function handleGetMe(): Promise<Response> {
  const context = await getSessionContext();
  return NextResponse.json({
    authenticated: context !== null,
    deviceId: context?.session.device_id ?? null,
    deviceLabel: context?.device.label ?? null,
    role: context?.role ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}

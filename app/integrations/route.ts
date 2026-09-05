import { NextResponse } from "next/server";
import { integrationSetupPage } from "@/lib/infra/setup-page";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  const page = integrationSetupPage();
  return new NextResponse(page.html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": page.csp, "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" } });
}

import { NextResponse } from "next/server";
import pkg from "../../../package.json";
import { IS_DEMO } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public liveness probe — no auth. Used by systemd WatchdogSec / Dokploy /
// uptime monitors. Cheap, never cached. Demo builds avoid exposing host uptime.
export async function GET() {
  if (IS_DEMO) {
    return NextResponse.json(
      {
        status: "ok",
        buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
        runtimeInstanceId: process.env.MSO_RUNTIME_INSTANCE_ID || null,
        version: pkg.version ?? "0.0.0",
        demo: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
      runtimeInstanceId: process.env.MSO_RUNTIME_INSTANCE_ID || null,
      uptime: Math.round(process.uptime()),
      version: pkg.version ?? "0.0.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

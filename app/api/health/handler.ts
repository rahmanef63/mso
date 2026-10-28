import { NextResponse } from "next/server";
import pkg from "../../../package.json";
import { IS_DEMO } from "@/lib/demo";

export async function handleGetHealth(): Promise<Response> {
  if (IS_DEMO) {
    return NextResponse.json(
      {
        status: "ok",
        service: "mso",
        buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
        buildSha: process.env.NEXT_PUBLIC_COMMIT_SHA || null,
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
      service: "mso",
      buildId: process.env.NEXT_PUBLIC_BUILD_ID || "dev",
      buildSha: process.env.NEXT_PUBLIC_COMMIT_SHA || null,
      runtimeInstanceId: process.env.MSO_RUNTIME_INSTANCE_ID || null,
      uptime: Math.round(process.uptime()),
      version: pkg.version ?? "0.0.0",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

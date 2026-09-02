import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { apiError } from "@/lib/host/request-api";
import { processes } from "@/lib/host/system-api";

export const dynamic = "force-dynamic";

// os-rr GET /sys/processes → top processes parsed from `ps` (Process[]).
export async function GET(req: Request) {
  if (!(await verifyAuth(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    return NextResponse.json(await processes());
  } catch (e) {
    return apiError("sys/processes", e);
  }
}

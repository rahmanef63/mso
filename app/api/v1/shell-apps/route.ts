import { NextRequest } from "next/server";
import { handleGetShellApps, handlePostShellApps } from "@/lib/surfaces/shell-apps-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleGetShellApps(request);
}

export async function POST(request: NextRequest) {
  return handlePostShellApps(request);
}

import { NextRequest } from "next/server";
import { handleGetShellAppDomain, handlePostShellAppDomain } from "@/lib/surfaces/shell-apps-domain-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  return handleGetShellAppDomain(request, context);
}

export async function POST(request: NextRequest, context: Context) {
  return handlePostShellAppDomain(request, context);
}

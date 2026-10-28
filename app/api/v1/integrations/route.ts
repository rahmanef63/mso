import { NextRequest } from "next/server";
import { handleGetIntegrations, handlePostIntegrations } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetIntegrations(req);
}

export async function POST(req: NextRequest) {
  return handlePostIntegrations(req);
}

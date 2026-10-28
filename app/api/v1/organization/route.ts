import { NextRequest } from "next/server";
import { getOrganizationResponse, handleOrganizationAction } from "@/lib/agent/organization-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return getOrganizationResponse(req);
}

export async function POST(req: NextRequest) {
  return handleOrganizationAction(req);
}

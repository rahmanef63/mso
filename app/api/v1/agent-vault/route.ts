import { NextRequest } from "next/server";
import { handleGetAgentVault, handlePostAgentVault } from "@/lib/agent-vault/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetAgentVault(req);
}

export async function POST(req: NextRequest) {
  return handlePostAgentVault(req);
}

import { NextRequest } from "next/server";
import { handleGetLocalAgents, handlePostLocalAgents } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetLocalAgents(req);
}

export async function POST(req: NextRequest) {
  return handlePostLocalAgents(req);
}

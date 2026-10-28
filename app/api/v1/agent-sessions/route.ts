import { NextRequest } from "next/server";
import { handleGetAgentSessions } from "./handler-get";
import { handlePostAgentSessions } from "./handler-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetAgentSessions(req);
}

export async function POST(req: NextRequest) {
  return handlePostAgentSessions(req);
}

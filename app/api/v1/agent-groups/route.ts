import { handleGetAgentGroup, handlePostAgentGroup } from "@/lib/agent-group/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetAgentGroup(req);
}

export async function POST(req: Request) {
  return handlePostAgentGroup(req);
}

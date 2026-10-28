import { NextRequest } from "next/server";
import { handleProjectMcp } from "@/lib/mcp/project-mcp-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handleProjectMcp(req);
}

import { NextRequest } from "next/server";
import { handleGetWorkflowEmbeds, handlePostWorkflowEmbeds } from "@/lib/host/workflow-embeds-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleGetWorkflowEmbeds(request);
}

export async function POST(request: NextRequest) {
  return handlePostWorkflowEmbeds(request);
}

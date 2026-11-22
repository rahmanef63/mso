import { NextRequest } from "next/server";
import { handleGetWorkflow } from "./route-read";
import { handlePostWorkflow } from "./route-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetWorkflow(req);
}

export async function POST(req: NextRequest) {
  return handlePostWorkflow(req);
}

import { NextRequest } from "next/server";
import { handleGetFlows, handlePostFlows } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetFlows(req);
}

export async function POST(req: NextRequest) {
  return handlePostFlows(req);
}

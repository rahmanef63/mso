import { NextRequest } from "next/server";
import { handleGetComposioSession, handlePostComposioSession } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetComposioSession(req);
}

export async function POST(req: NextRequest) {
  return handlePostComposioSession(req);
}

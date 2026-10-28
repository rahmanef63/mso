import { NextRequest } from "next/server";
import { handleGetComposioSession, handlePostComposioSession } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetComposioSession();
}

export async function POST(req: NextRequest) {
  return handlePostComposioSession(req);
}

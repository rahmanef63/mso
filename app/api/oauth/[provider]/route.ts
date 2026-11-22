import { NextRequest } from "next/server";
import { handlePostOAuth } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  return handlePostOAuth(req, ctx);
}

import { NextRequest } from "next/server";
import { handleGetChannels, handlePostChannels } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetChannels();
}

export async function POST(req: NextRequest) {
  return handlePostChannels(req);
}

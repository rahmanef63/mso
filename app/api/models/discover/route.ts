import { NextRequest } from "next/server";
import { handlePostDiscover } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handlePostDiscover(req);
}

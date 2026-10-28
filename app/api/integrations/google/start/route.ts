import { NextRequest } from "next/server";
import { handlePostGoogleStart } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handlePostGoogleStart(req);
}

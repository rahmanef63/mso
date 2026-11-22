import { NextRequest } from "next/server";
import { handlePostPassword } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handlePostPassword(req);
}

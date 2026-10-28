import { NextRequest } from "next/server";
import { handleGetPrefs, handlePostPrefs } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetPrefs();
}

export async function POST(req: NextRequest) {
  return handlePostPrefs(req);
}

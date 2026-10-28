import { NextRequest } from "next/server";
import { handleGetAccountIcon, handlePostAccountIcon } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetAccountIcon(req);
}

export async function POST(req: NextRequest) {
  return handlePostAccountIcon(req);
}

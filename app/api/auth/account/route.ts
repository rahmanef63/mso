import { NextRequest } from "next/server";
import { handleGetAccount, handlePostAccount } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetAccount();
}

export async function POST(req: NextRequest) {
  return handlePostAccount(req);
}

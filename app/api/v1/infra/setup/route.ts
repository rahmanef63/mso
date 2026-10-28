import { NextRequest } from "next/server";
import { handlePostInfraSetup } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return handlePostInfraSetup(req);
}

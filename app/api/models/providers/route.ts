import { NextRequest } from "next/server";
import { handleGetProviders } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetProviders(req);
}

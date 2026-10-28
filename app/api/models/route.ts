import { NextRequest } from "next/server";
import { handleGetModels } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleGetModels(req);
}

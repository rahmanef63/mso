import { handleGetCamoufoxSession } from "@/lib/camoufox/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetCamoufoxSession();
}

import { handleGetCamoufoxSession } from "@/lib/camoufox/http";


// Demo has no host, no display and no session — never hand out a credential there.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetCamoufoxSession();
}

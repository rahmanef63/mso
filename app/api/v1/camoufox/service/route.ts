import { handleGetCamoufoxService, handlePostCamoufoxService } from "@/lib/camoufox/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetCamoufoxService(req);
}

export async function POST(req: Request) {
  return handlePostCamoufoxService(req);
}

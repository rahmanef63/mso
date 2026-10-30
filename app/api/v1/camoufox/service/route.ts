import { handleGetCamoufoxService, handlePostCamoufoxService } from "@/lib/camoufox/http";


// Power for the Camoufox display, so the Browser app's on/off switch reaches the
// host instead of only hiding a window. Two actions, no unit name from the client —
// the module owns the unit, this route owns the gate.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetCamoufoxService(req);
}

export async function POST(req: Request) {
  return handlePostCamoufoxService(req);
}

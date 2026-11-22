import { handleGetSysUpdateAutomation, handlePostSysUpdateAutomation } from "@/lib/host/sys-update-automation-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleGetSysUpdateAutomation(req);
}

export async function POST(req: Request) {
  return handlePostSysUpdateAutomation(req);
}

import { handleGetSysUpdate, handlePostSysUpdate } from "@/lib/host/sys-update-service";


// A manual update is the operator's answer to the unattended pause. Clear the
// failure streak when this one was accepted; otherwise the gate keeps refusing
// forever and its own advice ("run mso update from a terminal") would be false.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleGetSysUpdate(req);
}

export async function POST(req: Request) {
  return handlePostSysUpdate(req);
}

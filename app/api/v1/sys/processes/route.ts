import { handleGetSysProcesses } from "@/lib/host/sys-system-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetSysProcesses(req);
}

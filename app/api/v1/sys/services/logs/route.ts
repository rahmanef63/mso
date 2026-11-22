import { handleGetSysServiceLogs } from "@/lib/host/sys-services-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetSysServiceLogs(req);
}

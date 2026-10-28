import { handleSysAudit } from "@/lib/host/sys-audit-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleSysAudit(req);
}

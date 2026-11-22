import { handleSysAudit } from "@/lib/host/sys-audit-service";


// The audit trail, read-only. Session-gated like every other /api/v1 route.
//
// There is deliberately NO MCP tool for this. The trail records what every MCP
// token did; letting a token read it would let a compromised one check whether it
// had been noticed, and edit nothing but its own expectations. Forensics is a
// surface for the owner in a browser, not for an agent.

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleSysAudit(req);
}

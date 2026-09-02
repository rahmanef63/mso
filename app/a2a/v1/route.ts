import { handleA2ARequest } from "@/lib/a2a/server";
import { msoCapabilityRuntime } from "@/lib/mcp/capability-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleA2ARequest(req, msoCapabilityRuntime);
}
export async function GET() {
  return Response.json(
    { error: "method_not_allowed" },
    { status: 405, headers: { allow: "POST" } },
  );
}

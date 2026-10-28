import { handleGetShellAppSession } from "@/lib/surfaces/shell-apps-session-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleGetShellAppSession(request, context);
}

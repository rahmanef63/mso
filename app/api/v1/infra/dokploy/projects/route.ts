import { json } from "@/lib/api/route";
import { requireSession } from "@/lib/auth/require-session";
import { withIntegrationSelection } from "@/lib/infra/connection-service";
import { selectionFrom } from "@/lib/infra/connection-dispatch";
import { listDokployProjects } from "@/lib/infra";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await requireSession("owner"))) return json({ error: "Unauthorized" }, 401);
  try {
    return json({ projects: await withIntegrationSelection(selectionFrom(Object.fromEntries(new URL(req.url).searchParams)), () => listDokployProjects()) });
  } catch (error) { return json({ error: (error as Error).message }, 503); }
}

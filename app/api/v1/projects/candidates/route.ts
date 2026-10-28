import { handleProjectCandidates } from "@/lib/host/project-candidates-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleProjectCandidates(req);
}

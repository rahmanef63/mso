import { handleGetMemoryGraph } from "@/lib/memory-graph/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetMemoryGraph(req);
}

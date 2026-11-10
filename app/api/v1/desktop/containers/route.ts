import { handleGetDesktopContainers } from "@/lib/desktop/http";

// Inventory of bot desktop containers (label `grokbot.desktop=1`). Read-only:
// no env vars, no full label map, no command surface.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetDesktopContainers(req);
}

import { handlePostDesktopLifecycle } from "@/lib/desktop/http";

// start | stop | restart | logs. Four fixed verbs, no arguments beyond a container
// id: this route is not an exec surface and must not grow into one.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handlePostDesktopLifecycle(req);
}

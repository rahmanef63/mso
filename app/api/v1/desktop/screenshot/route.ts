import { handleGetDesktopScreenshot } from "@/lib/desktop/http";

// PNG of one X display inside one bot desktop container. The `docker exec` argv is
// built entirely server-side; `screen` is normalised to ':' + digits before use and
// never reaches a shell.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetDesktopScreenshot(req);
}

import { handleGetSysCleanup, handlePostSysCleanup } from "@/lib/host/sys-cleanup-service";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetSysCleanup(req);
}

export async function POST(req: Request) {
  return handlePostSysCleanup(req);
}

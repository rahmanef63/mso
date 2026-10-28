import { handleGetSysUpdate, handlePostSysUpdate } from "@/lib/host/sys-update-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleGetSysUpdate(req);
}

export async function POST(req: Request) {
  return handlePostSysUpdate(req);
}

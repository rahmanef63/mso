import { handleGetSysMemoryBackup, handlePostSysMemoryBackup } from "@/lib/host/sys-memory-backup-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetSysMemoryBackup(req);
}

export async function POST(req: Request) {
  return handlePostSysMemoryBackup(req);
}

import { handleHeadTempShare, handleGetTempShare } from "@/lib/host/temp-share-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function HEAD(req: Request, context: { params: Promise<{ id: string }> }) {
  return handleHeadTempShare(req, context);
}

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  return handleGetTempShare(req, context);
}

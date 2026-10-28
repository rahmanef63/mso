import { handleTermStream } from "@/lib/host/term-stream-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleTermStream(req);
}

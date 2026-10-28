import { handleTermClose } from "@/lib/host/term-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleTermClose(req);
}

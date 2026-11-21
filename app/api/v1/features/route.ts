import { handleGetModularFeatures } from "@/lib/features/http-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetModularFeatures();
}

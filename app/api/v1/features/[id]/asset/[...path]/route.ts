import { NextRequest } from "next/server";
import { handleGetModularFeatureAsset } from "@/lib/features/http-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await context.params;
  return handleGetModularFeatureAsset(id, path);
}

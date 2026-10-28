import { NextRequest } from "next/server";
import { handleA2AGetRoute } from "./route-get";
import { handleA2APost } from "./route-post";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return handleA2AGetRoute(req);
}

export async function POST(req: NextRequest) {
  return handleA2APost(req);
}

import { NextRequest } from "next/server";
import { handleGetJev, handlePostJev } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetJev();
}

export async function POST(req: NextRequest) {
  return handlePostJev(req);
}

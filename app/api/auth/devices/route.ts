import { NextRequest } from "next/server";
import { handleGetDevices, handlePostDevices } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetDevices();
}

export async function POST(req: NextRequest) {
  return handlePostDevices(req);
}

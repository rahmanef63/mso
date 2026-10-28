import { NextRequest } from "next/server";
import { handleGetIntegrationsTransfer, handlePostIntegrationsTransfer } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetIntegrationsTransfer();
}

export async function POST(req: NextRequest) {
  return handlePostIntegrationsTransfer(req);
}

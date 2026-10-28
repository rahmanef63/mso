import { NextRequest } from "next/server";
import { handlePostDiscord } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePostDiscord(req, id);
}

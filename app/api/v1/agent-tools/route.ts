import { handleGetAgentTools, handlePostAgentTools } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetAgentTools();
}

export async function POST(req: Request) {
  return handlePostAgentTools(req);
}

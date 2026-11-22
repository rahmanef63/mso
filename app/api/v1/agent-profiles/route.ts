import { handleGetAgentProfiles, handlePostAgentProfiles } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetAgentProfiles();
}

export async function POST(req: Request) {
  return handlePostAgentProfiles(req);
}

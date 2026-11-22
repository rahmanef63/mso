import { NextRequest } from "next/server";
import { handleGetSkillMarket, handlePostSkillMarket } from "@/lib/skills/skill-market-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return handleGetSkillMarket();
}

export async function POST(req: NextRequest) {
  return handlePostSkillMarket(req);
}

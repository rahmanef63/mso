import { handlePostSocketPolicy } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handlePostSocketPolicy(req);
}

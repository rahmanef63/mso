import { handlePostTest } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return handlePostTest();
}

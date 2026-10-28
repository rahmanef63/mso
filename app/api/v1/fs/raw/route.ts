import { handleGetFsRaw } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetFsRaw(req);
}

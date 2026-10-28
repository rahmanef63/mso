import { handleGetFsUsage } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetFsUsage(req);
}

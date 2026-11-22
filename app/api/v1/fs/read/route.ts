import { handleGetFsRead } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetFsRead(req);
}

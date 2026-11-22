import { handleGetFsSearch } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetFsSearch(req);
}

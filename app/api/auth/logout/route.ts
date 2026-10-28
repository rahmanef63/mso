import { handlePostLogout } from "./handler";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handlePostLogout(req);
}

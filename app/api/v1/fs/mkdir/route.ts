import { handlePostFsMkdir } from "./handler";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handlePostFsMkdir(req);
}

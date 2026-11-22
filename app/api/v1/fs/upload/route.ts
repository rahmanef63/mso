import { handlePostFsUpload } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handlePostFsUpload(req);
}

import { handleGetEditorExec, handlePostEditorExec } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handleGetEditorExec(req);
}

export async function POST(req: Request) {
  return handlePostEditorExec(req);
}

import { handleOptionsRegister, handlePostRegister } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return handleOptionsRegister();
}

export async function POST(req: Request) {
  return handlePostRegister(req);
}

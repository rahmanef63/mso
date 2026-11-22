import { handleGetProtectedResource, handleOptionsProtectedResource } from "./handler";

export const runtime = "nodejs";

export async function OPTIONS() {
  return handleOptionsProtectedResource();
}

export async function GET(req: Request) {
  return handleGetProtectedResource(req);
}

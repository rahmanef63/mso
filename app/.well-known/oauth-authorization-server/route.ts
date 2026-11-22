import { handleGetAuthorizationServer, handleOptionsAuthorizationServer } from "./handler";

export const runtime = "nodejs";

export async function OPTIONS() {
  return handleOptionsAuthorizationServer();
}

export async function GET(req: Request) {
  return handleGetAuthorizationServer(req);
}

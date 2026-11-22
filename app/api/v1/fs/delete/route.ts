import { handleDeleteFs } from "./handler";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request) {
  return handleDeleteFs(req);
}

import { handlePostManagedAppInstall } from "./handler";

export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePostManagedAppInstall(req, id);
}

import { handleGetManagedAppSession } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleGetManagedAppSession(_req, id);
}

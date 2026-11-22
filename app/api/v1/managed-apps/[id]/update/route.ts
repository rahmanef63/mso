import { handleGetManagedAppUpdate, handlePostManagedAppUpdate } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleGetManagedAppUpdate(req, id);
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePostManagedAppUpdate(req, id);
}

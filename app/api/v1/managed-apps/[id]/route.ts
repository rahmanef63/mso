import { handleGetManagedApp, handlePostManagedApp } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleGetManagedApp(req, id);
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePostManagedApp(req, id);
}

import { handleGetManagedAppJobs } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleGetManagedAppJobs(req, id);
}

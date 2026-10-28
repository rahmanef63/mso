import { handleGetManagedAppJob, handleDeleteManagedAppJob } from "./handler";

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;
  return handleGetManagedAppJob(req, id, jobId);
}

export async function DELETE(req: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  const { id, jobId } = await context.params;
  return handleDeleteManagedAppJob(req, id, jobId);
}

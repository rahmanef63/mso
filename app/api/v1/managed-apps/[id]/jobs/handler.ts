import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { listManagedAppJobs } from "@/lib/managed-apps/jobs";

export async function handleGetManagedAppJobs(req: Request, id: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  return NextResponse.json({ jobs: await listManagedAppJobs(id) });
}

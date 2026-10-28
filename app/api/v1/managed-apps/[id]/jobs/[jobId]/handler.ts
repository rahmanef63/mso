import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { auditJobCompletion } from "@/lib/managed-apps/job-audit";
import { cancelManagedAppJob, readManagedAppJob } from "@/lib/managed-apps/jobs";

export async function handleGetManagedAppJob(req: Request, id: string, jobId: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  const raw = Number(new URL(req.url).searchParams.get("since") ?? 0);
  const since = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  const job = await readManagedAppJob(jobId, since);
  if (!job || job.applicationId !== id) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  auditJobCompletion(job);
  return NextResponse.json({ job });
}

export async function handleDeleteManagedAppJob(req: Request, id: string, jobId: string): Promise<Response> {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (IS_DEMO) return NextResponse.json({ error: "demo mode is read-only" }, { status: 403 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  if (rateLimited(`managed-app:${id}`, 12, 60_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const cancelled = cancelManagedAppJob(jobId, id);
  await audit({
    action: "managed-app.action",
    actor: await getSessionActor(),
    target: id,
    ok: cancelled,
    detail: "job.cancel",
    meta: { jobId },
  });
  if (!cancelled) return NextResponse.json({ error: "no cancellable job" }, { status: 404 });
  return NextResponse.json({ cancelled: true }, { status: 202 });
}

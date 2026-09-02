import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { auditJobCompletion } from "@/lib/managed-apps/job-audit";
import { cancelManagedAppJob, readManagedAppJob } from "@/lib/managed-apps/jobs";

// The poll endpoint. `?since=<logOffset>` returns only the transcript written
// after that cursor, so a 2 s poll of a 30-minute update stays cheap (a live
// job is served from the runner's memory, never re-read off disk).

export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, jobId } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  const raw = Number(new URL(req.url).searchParams.get("since") ?? 0);
  const since = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  const job = await readManagedAppJob(jobId, since);
  // A job id from another app must 404 here, not leak that app's transcript
  // into a window the operator opened for this one.
  if (!job || job.applicationId !== id) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  // The outcome half of the audit trail, written once per job id. It belongs in
  // the runner's terminal path (one line, see job-audit.ts) — this is the
  // backstop that also covers a job that ended in a process which is no longer
  // this one, e.g. a record reconciled to `interrupted` after a deploy.
  auditJobCompletion(job);
  return NextResponse.json({ job });
}

// The way out of a wedged operation. A job holds the app's lock until it reaches
// a terminal status, so anything that leaves one running — a leaked grandchild
// keeping the pipes open past its own reaper, a CLI that hangs below its timeout —
// makes every later start/stop/restart/update/backup on that app answer 409. The
// only other cure is restarting mso, which is precisely what an operator must
// not do mid-update. It cannot end a healthy job by accident: the exact 24-hex id
// AND its owning app are required, the outcome is always `failed` and never
// `succeeded`, and cancelManagedAppJob refuses (false, never throws) while the job
// is still inside its mandatory pre-flight backup — abandoning that copy is the
// outcome the backup exists to prevent.
export async function DELETE(req: Request, context: { params: Promise<{ id: string; jobId: string }> }) {
  if (!(await verifyAuth(req, "owner"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (IS_DEMO) return NextResponse.json({ error: "demo mode is read-only" }, { status: 403 });
  const { id, jobId } = await context.params;
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

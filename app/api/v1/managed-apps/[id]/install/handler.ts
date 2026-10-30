import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { audit } from "@/lib/host/audit-api";
import { optionalString, readJson } from "@/lib/host/request-api";
import { rateLimited } from "@/lib/host/limits-api";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { startInstall } from "@/lib/managed-apps/install";
import { rememberJobActor } from "@/lib/managed-apps/job-audit";
import { redact } from "@/lib/managed-apps/redact";


// Same gate order as every other managed-app route: verifyAuth -> demo 403 ->
// rate limit -> the lib (which takes the operation lock) -> audit. Answers 202 +
// a job id; the transcript is polled at /jobs/<id> like update's.
//
// This route is the one place in the managed-app surface that receives a
// CREDENTIAL, so two things are deliberate and must stay that way:
//   1. `apiKey` is handed to startInstall and nowhere else. It is not echoed in
//      the response, not put in the audit meta, and not passed as a job argv —
//      the argv IS persisted and IS audited (see the meta below, which prints
//      it verbatim for every job).
//   2. The audit line records THAT a provider was configured, never which key.
//      `provider` is an allowlisted id, so it is safe to log; the key is not.

export async function handlePostManagedAppInstall(req: Request, id: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (IS_DEMO) return NextResponse.json({ error: "managed application actions are disabled in demo mode" }, { status: 403 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });

  const body = await readJson(req);
  const provider = optionalString(body, "provider");
  const bind = optionalString(body, "bind");
  const rawKey = (body as { apiKey?: unknown } | null)?.apiKey;
  if (provider === null || bind === null || (rawKey !== undefined && typeof rawKey !== "string")) {
    return NextResponse.json({ error: "unsupported request field" }, { status: 400 });
  }

  if (rateLimited(`managed-app:${id}`, 12, 60_000)) {
    return NextResponse.json({ error: "too many operations" }, { status: 429 });
  }

  const actor = await getSessionActor();
  try {
    const job = await startInstall(id, { provider, apiKey: typeof rawKey === "string" ? rawKey : null, bind });
    rememberJobActor(job.id, actor);
    await audit({
      action: "managed-app.action",
      target: id,
      actor,
      ok: true,
      detail: "install.start",
      meta: { jobId: job.id, argv: job.argv.join(" "), ...(provider ? { provider } : {}), ...(bind ? { bind } : {}) },
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const reason = redact(error instanceof Error ? error.message : "install failed to start");
    await audit({ action: "managed-app.action", target: id, actor, ok: false, detail: "install.start", meta: { reason } });
    const bad = reason.includes("unsupported") || reason.includes("not look like") || reason.includes("not supported by");
    return NextResponse.json({ error: reason }, { status: bad ? 400 : 409 });
  }
}

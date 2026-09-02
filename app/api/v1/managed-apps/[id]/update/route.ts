import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getSessionActor } from "@/lib/auth/require-session";
import { IS_DEMO } from "@/lib/demo";
import { audit } from "@/lib/host/audit-api";
import { optionalString, readJson } from "@/lib/host/request-api";
import { rateLimited } from "@/lib/host/limits-api";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { rememberJobActor } from "@/lib/managed-apps/job-audit";
import { redact } from "@/lib/managed-apps/redact";
import type { ManagedAppId, ManagedAppJob } from "@/lib/managed-apps/types";
import { cachedUpdateStatus, checkUpdate, setChannel, startRollback, startUninstall, startUpdate } from "@/lib/managed-apps/update";

// Same gate order as every other managed-app route: verifyAuth -> demo 403 ->
// action allowlist -> rate limit -> the lib (which takes the operation lock) ->
// audit. The allowlist moved ahead of the limiter only because the action now
// chooses WHICH budget to spend; an action outside it still does no work.
// The four destructive actions answer 202 + a job id and are polled at
// /jobs/<id>; only `check` answers inline. GET is a cache read (see there).

export const dynamic = "force-dynamic";

const ACTIONS = ["check", "apply", "channel", "rollback", "uninstall"] as const;
type Action = (typeof ACTIONS)[number];

/** Our own thrown messages are deliberate and belong in the response — the UI
 *  shows them verbatim. Redacted anyway: a backup failure carries a path, and
 *  paths are one bad `HERMES_HOME` away from carrying something else. */
const explain = (error: unknown): string => redact(error instanceof Error ? error.message : "managed application operation failed");

/** 400 = the REQUEST is wrong (a field, a value, a missing confirmation).
 *  409 = the request is fine but the host is not in a state to serve it (lock
 *  held, CLI missing, app still running, manifest mismatch). */
const BAD_REQUEST = ["confirmation", "unsupported", "is not supported", "unknown backup"];

function statusFor(reason: string): number {
  if (reason.includes("already running")) return 409; // the operation lock
  return BAD_REQUEST.some((signal) => reason.includes(signal)) ? 400 : 409;
}

// READ-ONLY, and that is load-bearing: the CSRF gate in proxy.ts only covers
// POST/PUT/PATCH/DELETE, and the session cookie is Domain=mso.rahmanef.com with
// SameSite=Strict, so every sibling origin under rahmanef.com (~100 on this
// box) can make the browser send this GET. If it probed, that would be a blind
// cross-origin trigger for `hermes update --check` — two git fetches inside the
// operator's own checkout — from any of them. So it serves the cache and
// nothing else; the probe is `POST {action:"check"}`, behind the gate.
export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  return NextResponse.json(cachedUpdateStatus(id));
}

async function dispatch(id: ManagedAppId, action: Action, body: unknown): Promise<{ job?: ManagedAppJob; status?: unknown; detail: string }> {
  if (action === "check") return { status: await checkUpdate(id, true), detail: "update.check" };
  const channel = optionalString(body, "channel");
  const tag = optionalString(body, "tag");
  const branch = optionalString(body, "branch");
  const backupId = optionalString(body, "backupId");
  const pin = optionalString(body, "pin");
  const confirm = optionalString(body, "confirm");
  if (channel === null || tag === null || branch === null || backupId === null || pin === null || confirm === null) {
    throw new Error("unsupported request field");
  }
  const dryRun = (body as { dryRun?: unknown })?.dryRun === true;
  const noRestart = (body as { noRestart?: unknown })?.noRestart === true;
  if (action === "apply") return { job: await startUpdate(id, { dryRun, channel, tag, branch, noRestart }), detail: "update.apply" };
  if (action === "channel") {
    if (!channel) throw new Error("unsupported update channel");
    return { job: await setChannel(id, channel), detail: "update.channel" };
  }
  if (action === "rollback") {
    if (!backupId) throw new Error("unknown backup");
    return { job: await startRollback(id, backupId, pin), detail: "update.rollback" };
  }
  return { job: await startUninstall(id, confirm, dryRun), detail: "update.uninstall" };
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (IS_DEMO) return NextResponse.json({ error: "managed application actions are disabled in demo mode" }, { status: 403 });
  const { id } = await context.params;
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  const body = await readJson(req);
  const action = (body as { action?: unknown })?.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "unsupported managed application action" }, { status: 400 });
  }
  // Two budgets, because they protect different things: a probe spawns the CLI
  // (and git-fetches twice for Hermes) — the bucket the GET used to spend —
  // while the four destructive actions share the lifecycle route's per-app one.
  // A single bucket would let a burst of checks lock out an uninstall.
  const probing = action === "check";
  if (rateLimited(probing ? `managed-app-check:${id}` : `managed-app:${id}`, probing ? 10 : 12, 60_000)) {
    return NextResponse.json({ error: "too many operations" }, { status: 429 });
  }
  const actor = await getSessionActor();
  try {
    const result = await dispatch(id, action as Action, body);
    // The job outlives this request, so the actor is stamped here for the
    // completion line the job layer writes later (job-audit.ts).
    if (result.job) rememberJobActor(result.job.id, actor);
    // Enough to reconstruct what happened: which flow, which job to read the
    // transcript from, and the options that shaped the argv.
    await audit({
      action: "managed-app.action",
      target: id,
      actor,
      ok: true,
      detail: result.detail,
      meta: { ...(result.job ? { jobId: result.job.id, argv: result.job.argv.join(" ") } : {}), ...flags(body) },
    });
    return result.job ? NextResponse.json({ job: result.job }, { status: 202 }) : NextResponse.json({ status: result.status });
  } catch (error) {
    const reason = explain(error);
    await audit({ action: "managed-app.action", target: id, actor, ok: false, detail: `update.${action}`, meta: { reason, ...flags(body) } });
    return NextResponse.json({ error: reason }, { status: statusFor(reason) });
  }
}

/** The request's shape, flattened for the audit line. Never the confirmation
 *  text and never a free-form field — only what was actually asked for. */
function flags(body: unknown): Record<string, string | boolean> {
  const source = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, string | boolean> = {};
  for (const key of ["channel", "tag", "branch", "backupId", "pin"]) if (typeof source[key] === "string") out[key] = source[key] as string;
  if (source.dryRun === true) out.dryRun = true;
  if (source.noRestart === true) out.noRestart = true;
  return out;
}

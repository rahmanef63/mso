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

const ACTIONS = ["check", "apply", "channel", "rollback", "uninstall"] as const;
type Action = (typeof ACTIONS)[number];

const explain = (error: unknown): string => redact(error instanceof Error ? error.message : "managed application operation failed");
const BAD_REQUEST = ["confirmation", "unsupported", "is not supported", "unknown backup"];

function statusFor(reason: string): number {
  if (reason.includes("already running")) return 409;
  return BAD_REQUEST.some((signal) => reason.includes(signal)) ? 400 : 409;
}

export async function handleGetManagedAppUpdate(req: Request, id: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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

export async function handlePostManagedAppUpdate(req: Request, id: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (IS_DEMO) return NextResponse.json({ error: "managed application actions are disabled in demo mode" }, { status: 403 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  const body = await readJson(req);
  const action = (body as { action?: unknown })?.action;
  if (typeof action !== "string" || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "unsupported managed application action" }, { status: 400 });
  }
  const probing = action === "check";
  if (rateLimited(probing ? `managed-app-check:${id}` : `managed-app:${id}`, probing ? 10 : 12, 60_000)) {
    return NextResponse.json({ error: "too many operations" }, { status: 429 });
  }
  const actor = await getSessionActor();
  try {
    const result = await dispatch(id, action as Action, body);
    if (result.job) rememberJobActor(result.job.id, actor);
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

function flags(body: unknown): Record<string, string | boolean> {
  const source = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, string | boolean> = {};
  for (const key of ["channel", "tag", "branch", "backupId", "pin"]) if (typeof source[key] === "string") out[key] = source[key] as string;
  if (source.dryRun === true) out.dryRun = true;
  if (source.noRestart === true) out.noRestart = true;
  return out;
}

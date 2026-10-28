import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyAuth } from "@/lib/agent/server";
import { camoufoxStatus, setCamoufoxEnabled } from "@/lib/camoufox/service";
import { apiError, readJson } from "@/lib/host/request-api";
import { probeViewerTransport } from "@/lib/camoufox/viewer-transport";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { camoufoxViewerOrigin } from "@/lib/camoufox/origin";
import { createCamoufoxViewerTicket } from "@/lib/camoufox/viewer-auth";
import { CAMOUFOX_VIEWER_PUBLIC_PREFIX } from "@/lib/camoufox/viewer-path";
import { IS_DEMO } from "@/lib/demo";

const PASSWD_FILE = process.env.CAMOUFOX_VNC_PASSWD_TEXT
  ?? path.join(os.homedir(), ".vnc/passwd.txt");

export async function handleGetCamoufoxService(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    if (new URL(req.url).searchParams.get("probe") === "viewer") {
      if (rateLimited("camoufox.viewer-probe", 30, 60_000))
        return Response.json({ error: "too many viewer probes" }, { status: 429 });
      return Response.json(await probeViewerTransport(), { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(await camoufoxStatus());
  } catch (e) {
    return apiError("camoufox/service", e);
  }
}

export async function handlePostCamoufoxService(req: Request): Promise<Response> {
  if (!(await verifyAuth(req))) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (rateLimited("camoufox", 12, 60_000)) {
    return Response.json({ error: "too many operations" }, { status: 429 });
  }
  try {
    const { action } = (await readJson(req)) as { action?: unknown };
    if (action !== "start" && action !== "stop") {
      return Response.json({ error: "action must be 'start' or 'stop'" }, { status: 400 });
    }

    const status = await setCamoufoxEnabled(action === "start");
    audit({
      action: "camoufox.power",
      target: "camoufox-vnc.service",
      ok: status.running === (action === "start"),
      detail: action,
    });
    return Response.json(status);
  } catch (e) {
    return apiError("camoufox/service", e);
  }
}

export async function handleGetCamoufoxSession(): Promise<Response> {
  if (IS_DEMO) return Response.json({ error: "unavailable" }, { status: 404 });
  const context = await getSessionContext();
  if (!context?.session.device_id || !roleAtLeast(context.role, "operator")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const viewerOrigin = camoufoxViewerOrigin();
  const secret = process.env.OS_SESSION_SECRET ?? "";
  if (!viewerOrigin || secret.length < 32) {
    return Response.json({ error: "viewer_unconfigured" }, { status: 503 });
  }
  const viewerTicket = createCamoufoxViewerTicket(context.session, secret);

  const password = (await fs.readFile(PASSWD_FILE, "utf8").catch(() => "")).trim();
  if (!password) {
    return Response.json({
      password: null,
      viewerOrigin,
      viewerTicket,
      viewerPathPrefix: CAMOUFOX_VIEWER_PUBLIC_PREFIX,
      reason: "no_password_file",
    });
  }
  return Response.json({ password, viewerOrigin, viewerTicket, viewerPathPrefix: CAMOUFOX_VIEWER_PUBLIC_PREFIX });
}

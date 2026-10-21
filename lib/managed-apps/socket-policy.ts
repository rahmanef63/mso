import type { NextRequest } from "next/server";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import { MANAGED_APP_SESSION_COOKIE, verifyManagedAppSession } from "./session";
import { CAMOUFOX_VIEWER_COOKIE, verifyCamoufoxViewerCookie } from "@/lib/camoufox/viewer-auth";
import { getApprovedDevice } from "@/lib/auth/device-store";
import { deviceSessionValid } from "@/lib/auth/live-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { isCamoufoxViewerHost } from "@/lib/camoufox/origin";
import { camoufoxViewerUpstreamPath } from "@/lib/camoufox/viewer-gate";
import { managedAppIdForHost, managedAppOrigin } from "./origin";
import { getManagedAppDefinition } from "./catalog";
import { managedAppUpstream } from "./upstream-target";
import { upstreamSocketHeaders } from "./proxy-headers";
import { IS_DEMO } from "@/lib/demo";
import { shellAppSocketPolicy } from "@/lib/surfaces/socket-policy";
import { deny, type OrcaReadinessResult } from "./orca-readiness-parse";

export interface SocketPolicyDeps {
  getOrcaReadiness?: () => Promise<OrcaReadinessResult>;
}

async function defaultOrcaReadiness(): Promise<OrcaReadinessResult> {
  try {
    const { getOrcaReadiness } = await import("./orca-readiness");
    return await getOrcaReadiness();
  } catch {
    return deny("bridge_unavailable");
  }
}

export async function socketPolicy(request: NextRequest, deps: SocketPolicyDeps = {}) {
  if (IS_DEMO || request.method !== "GET") return null;
  const host = request.headers.get("host") ?? "", origin = request.headers.get("origin");
  if (origin) { try { if (new URL(origin).host !== host) return null; } catch { return null; } }
  if (!/(?:^|,)\s*websocket\s*(?:,|$)/i.test(request.headers.get("upgrade") ?? "")) return null;
  const viewer = isCamoufoxViewerHost(host), app = managedAppIdForHost(host);
  if (!viewer && !app) return shellAppSocketPolicy(request);
  if (app === "orca") {
    if (!origin || origin === "null") return null;
    const expected = managedAppOrigin("orca");
    if (!expected) return null;
    try { if (new URL(origin).origin.toLowerCase() !== expected.toLowerCase()) return null; } catch { return null; }
  }
  const secret = process.env.OS_SESSION_SECRET ?? "";
  let identity: string | undefined;
  for (const { value } of request.cookies.getAll(viewer ? CAMOUFOX_VIEWER_COOKIE : MANAGED_APP_SESSION_COOKIE)) {
    const session = viewer ? verifyCamoufoxViewerCookie(value, secret) : verifyManagedAppSession(app!, value, secret);
    if (!session?.device_id) continue;
    if (viewer) {
      const device = await getApprovedDevice(session.device_id);
      if (!deviceSessionValid(session, device) || !roleAtLeast(device.role, "operator")) continue;
    } else if (!await liveSessionAuthorized(session, "operator")) continue;
    identity = session.device_id; break;
  }
  if (!identity) return null;
  let socketIdentity = identity;
  let base: URL;
  try {
    if (viewer) {
      base = managedAppUpstream(process.env.CAMOUFOX_NOVNC_URL ?? "http://127.0.0.1:6080");
    } else if (app === "orca") {
      // Re-verify readiness on every authorization (initial and each revalidation):
      // the session proves WHO, not that the owned runtime still owns the endpoint.
      // The identity also binds device to the exact runtime/PID/start ticks/inode so a
      // same-device runtime swap changes identity and closes the live socket.
      const readiness = await (deps.getOrcaReadiness ?? defaultOrcaReadiness)();
      if (!readiness.available || !readiness.runtimeId || !readiness.startTicks) return null;
      socketIdentity = JSON.stringify({
        device: identity,
        runtimeId: readiness.runtimeId,
        serverPid: readiness.serverPid,
        startTicks: readiness.startTicks,
        listenerInode: readiness.listenerInode ?? null,
      });
      base = new URL(readiness.boundEndpoint);
      if (base.protocol !== "ws:" || base.username || base.password) return null;
      base.protocol = "http:";
    } else {
      base = managedAppUpstream(getManagedAppDefinition(app!).dashboardUrl);
    }
  } catch {
    return null;
  }
  const pathname = viewer ? camoufoxViewerUpstreamPath(request.nextUrl.pathname) : request.nextUrl.pathname;
  if (!pathname || pathname.startsWith("/_next")) return null;
  const target = new URL(base); target.pathname = pathname; target.search = request.nextUrl.search;
  return { identity: socketIdentity, target: target.toString(), headers: Object.fromEntries(upstreamSocketHeaders(request.headers, app ?? undefined, base)) };
}

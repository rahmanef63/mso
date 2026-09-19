import { NextResponse, type NextRequest } from "next/server";
import { getApprovedDevice } from "@/lib/auth/device-store";
import { roleAtLeast } from "@/lib/auth/roles";
import { camoufoxViewerCsp } from "./origin";
import {
  CAMOUFOX_VIEWER_COOKIE,
  CAMOUFOX_VIEWER_COOKIE_TTL_MS,
  createCamoufoxViewerCookie,
  verifyCamoufoxViewerCookie,
  verifyCamoufoxViewerTicket,
} from "./viewer-auth";
import { IS_DEMO } from "@/lib/demo";
import { CAMOUFOX_VIEWER_ENTRY_PATH, CAMOUFOX_VIEWER_PUBLIC_PREFIX } from "./viewer-path";

const AUTHORIZED = Symbol("camoufox-viewer-authorized");
export type CamoufoxViewerGateResult = typeof AUTHORIZED | NextResponse;


function noStore(headers: Headers): void {
  headers.set("cache-control", "no-store");
  headers.set("cdn-cache-control", "no-store");
  headers.set("cloudflare-cdn-cache-control", "no-store");
}

function notFound() {
  const response = new NextResponse("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  noStore(response.headers);
  return response;
}

async function approvedDevice(token: string, kind: "ticket" | "cookie"): Promise<string | null> {
  if (IS_DEMO) return null;
  const secret = process.env.OS_SESSION_SECRET ?? "";
  const payload = kind === "ticket"
    ? verifyCamoufoxViewerTicket(token, secret)
    : verifyCamoufoxViewerCookie(token, secret);
  if (!payload?.device_id) return null;
  const device = await getApprovedDevice(payload.device_id);
  return device && roleAtLeast(device.role, "operator") ? payload.device_id : null;
}

async function hasViewerSession(request: NextRequest): Promise<boolean> {
  for (const { value } of request.cookies.getAll(CAMOUFOX_VIEWER_COOKIE)) {
    if (await approvedDevice(value, "cookie")) return true;
  }
  return false;
}

const BOOTSTRAP_HTML = [
  "<!doctype html><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow\">",
  "<title>MSO Browser authorization</title>",
  "<body><p>Authorizing secure browser viewer...</p>",
  "<script src=\"/__viewer_bootstrap.js\" defer></script></body>",
].join("");

const BOOTSTRAP_JS = [
  "(async()=>{",
  "const p=new URLSearchParams(location.hash.slice(1));",
  "const t=p.get('viewer_ticket');",
  "if(!t){document.body.textContent='Viewer authorization required.';return;}",
  "p.delete('viewer_ticket');",
  "const r=await fetch('/__viewer_auth',{method:'POST',headers:{authorization:'Bearer '+t},credentials:'include',cache:'no-store'});",
  "if(!r.ok){document.body.textContent='Viewer authorization failed.';return;}",
  "location.replace(location.pathname+location.search+(p.toString()?'#'+p.toString():''));",
  "})().catch(()=>{document.body.textContent='Viewer authorization failed.';});",
].join("");

function bootstrap(method: string) {
  const response = new NextResponse(method === "HEAD" ? null : BOOTSTRAP_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": camoufoxViewerCsp(),
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    },
  });
  // The global cockpit header is DENY. This split-origin viewer is the one exception:
  // its CSP frame-ancestors names the exact cockpit and remains the authoritative gate.
  response.headers.delete("x-frame-options");
  noStore(response.headers);
  return response;
}

function bootstrapScript() {
  const response = new NextResponse(BOOTSTRAP_JS, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    },
  });
  noStore(response.headers);
  return response;
}

async function exchangeTicket(request: NextRequest) {
  if (request.method !== "POST") return notFound();
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return notFound();
  const deviceId = await approvedDevice(match[1], "ticket");
  if (!deviceId) return notFound();

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(
    CAMOUFOX_VIEWER_COOKIE,
    createCamoufoxViewerCookie(deviceId, process.env.OS_SESSION_SECRET ?? ""),
    {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: Math.floor(CAMOUFOX_VIEWER_COOKIE_TTL_MS / 1000),
    },
  );
  noStore(response.headers);
  return response;
}

/**
 * Authorize the dedicated Camoufox sibling origin without ever sharing the cockpit
 * session cookie. Before authorization, only the inert bootstrap and ticket exchange
 * exist. The returned symbol means the caller may proxy a read-only noVNC request.
 */
export async function gateCamoufoxViewer(
  request: NextRequest,
  pathname: string,
): Promise<CamoufoxViewerGateResult> {
  if (pathname === "/__viewer_bootstrap.js") {
    return request.method === "GET" ? bootstrapScript() : notFound();
  }
  if (pathname === "/__viewer_auth") return exchangeTicket(request);

  if (
    (request.method === "GET" || request.method === "HEAD") &&
    (pathname === "/" || pathname === "/vnc.html")
  ) {
    const redirect = new URL(request.url);
    redirect.pathname = CAMOUFOX_VIEWER_ENTRY_PATH;
    return NextResponse.redirect(redirect, 307);
  }

  const inViewerNamespace =
    pathname === CAMOUFOX_VIEWER_PUBLIC_PREFIX ||
    pathname.startsWith(CAMOUFOX_VIEWER_PUBLIC_PREFIX + "/");
  if (!inViewerNamespace) return notFound();

  if (await hasViewerSession(request)) return AUTHORIZED;
  if (
    (request.method === "GET" || request.method === "HEAD") &&
    pathname === CAMOUFOX_VIEWER_ENTRY_PATH
  ) return bootstrap(request.method);
  return notFound();
}

export function camoufoxViewerUpstreamPath(pathname: string): string | null {
  if (
    pathname !== CAMOUFOX_VIEWER_PUBLIC_PREFIX &&
    !pathname.startsWith(CAMOUFOX_VIEWER_PUBLIC_PREFIX + "/")
  ) return null;
  const stripped = pathname.slice(CAMOUFOX_VIEWER_PUBLIC_PREFIX.length);
  return stripped === "" || stripped === "/" ? "/vnc.html" : stripped;
}

export function camoufoxViewerAuthorized(
  result: CamoufoxViewerGateResult,
): result is typeof AUTHORIZED {
  return result === AUTHORIZED;
}

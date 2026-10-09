import { NextResponse, type NextRequest } from "next/server";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import type { SurfaceApp } from "@/lib/contracts/surface-app";
import { createShellAppCredential, verifyShellAppCredential, shellAppSession, SHELL_APP_COOKIE, SHELL_APP_COOKIE_TTL } from "./session";

export function shellSessionHeaders() {
  return { "cache-control": "no-store, no-transform", "cdn-cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
}
export function shellAppResponseHeaders() {
  return { ...shellSessionHeaders(), "content-security-policy": `frame-ancestors ${new URL(process.env.OS_PUBLIC_ORIGIN!).origin}` };
}
function response(body: string | null, status: number, contentType = "text/plain; charset=utf-8") {
  return new NextResponse(body, { status, headers: { ...shellAppResponseHeaders(), "content-type": contentType,
    "content-security-policy": `default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors ${new URL(process.env.OS_PUBLIC_ORIGIN!).origin}` } });
}
function script(app: SurfaceApp) {
  const cockpit = new URL(process.env.OS_PUBLIC_ORIGIN!).origin;
  const login = new URL("/login", cockpit);
  login.searchParams.set("returnTo", `/api/v1/shell-apps/${encodeURIComponent(app.id)}/session?redirect=1`);
  return `(async()=>{const p=new URLSearchParams(location.hash.slice(1));const t=p.get('app_ticket');p.delete('app_ticket');history.replaceState(null,'',location.pathname+location.search+(p.toString()?'#'+p.toString():''));if(!t){location.replace(${JSON.stringify(login)});return;}const r=await fetch('/__mso_app_auth',{method:'POST',headers:{authorization:'Bearer '+t},credentials:'include',cache:'no-store'});if(!r.ok){document.body.textContent='MSO session expired. Reopen this application from MSO.';return;}location.reload();})().catch(()=>{document.body.textContent='Application authorization failed.';});`;
}
export async function gateShellApp(request: NextRequest, app: SurfaceApp) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/__mso_app_bootstrap.js") return request.method === "GET" ? response(script(app), 200, "application/javascript; charset=utf-8") : response(null, 404);
  if (pathname === "/__mso_app_auth") {
    if (request.method !== "POST" || request.headers.get("origin") !== app.origin) return response(null, 403);
    const token = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const secret = process.env.OS_SESSION_SECRET ?? "";
    const session = token ? verifyShellAppCredential(app, token, secret, "ticket") : null;
    if (!session || !await liveSessionAuthorized(session, "owner")) return response(null, 401);
    const result = response(null, 204);
    result.cookies.set(SHELL_APP_COOKIE, createShellAppCredential(app, session, secret, "cookie"), {
      httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: Math.floor(Math.max(0, Math.min(SHELL_APP_COOKIE_TTL, session.parent_expires_at - Date.now()) / 1000)),
    });
    return result;
  }
  if (await shellAppSession(request, app)) return null;
  if (request.method !== "GET" || !["document", "iframe"].includes(request.headers.get("sec-fetch-dest") ?? "")) return response(null, 401);
  return response('<!doctype html><meta charset="utf-8"><title>MSO application authorization</title><body><p>Authorizing application...</p><script src="/__mso_app_bootstrap.js" defer></script></body>', 200, "text/html; charset=utf-8");
}

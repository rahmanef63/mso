import { NextResponse, type NextRequest } from "next/server";
import { MIN_SECRET_LEN, signSession, verifySession, type SessionPayload } from "@/lib/auth/session";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import { managedAppOrigin, cockpitOrigin } from "./origin";
import type { ManagedAppId } from "./types";

export const MANAGED_APP_SESSION_COOKIE = "__Host-mso-managed-app";
const TICKET_TTL = 60_000;
const COOKIE_TTL = 2 * 60 * 60 * 1000;
function key(id: ManagedAppId, kind: "ticket" | "cookie", secret: string): string {
  const origin = managedAppOrigin(id);
  if (!origin || secret.length < MIN_SECRET_LEN) throw new Error("managed application authorization is unavailable");
  return `managed-app:${origin}:${kind}:${secret}`;
}
export function createManagedAppTicket(id: ManagedAppId, session: SessionPayload, secret: string, now = Date.now()): string {
  return signSession({ ...session, expires_at: Math.min(session.expires_at, now + TICKET_TTL) }, key(id, "ticket", secret));
}
export function createManagedAppCookie(id: ManagedAppId, session: SessionPayload, secret: string): string {
  return signSession({ ...session, expires_at: Date.now() + COOKIE_TTL }, key(id, "cookie", secret));
}
export function verifyManagedAppSession(id: ManagedAppId, token: string, secret: string, kind: "ticket" | "cookie" = "cookie"): SessionPayload | null {
  try { return verifySession(token, key(id, kind, secret)); } catch { return null; }
}
export async function managedAppSession(request: Request, id: ManagedAppId): Promise<SessionPayload | null> {
  const secret = process.env.OS_SESSION_SECRET ?? "";
  const candidates = (request.headers.get("cookie") ?? "").split(";");
  for (const candidate of candidates) {
    const [name, ...parts] = candidate.trim().split("=");
    if (name !== MANAGED_APP_SESSION_COOKIE) continue;
    const session = verifyManagedAppSession(id, parts.join("="), secret);
    if (session && await liveSessionAuthorized(session, "operator")) return session;
  }
  return null;
}

const SCRIPT = "(async()=>{const p=new URLSearchParams(location.hash.slice(1));const t=p.get('app_ticket');p.delete('app_ticket');history.replaceState(null,'',location.pathname+location.search+(p.toString()?'#'+p.toString():''));if(!t){document.body.textContent='Open this application from MSO to authorize it.';return;}const r=await fetch('/__mso_app_auth',{method:'POST',headers:{authorization:'Bearer '+t},credentials:'include',cache:'no-store'});if(!r.ok){document.body.textContent='Application authorization failed. Reopen it from MSO.';return;}location.reload();})().catch(()=>{document.body.textContent='Application authorization failed.';});";
function response(body: string | null, status: number, contentType = "text/plain; charset=utf-8") {
  return new NextResponse(body, { status, headers: {
    "content-type": contentType, "cache-control": "no-store, no-transform",
    "cdn-cache-control": "no-store", "cloudflare-cdn-cache-control": "no-store",
    "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "content-security-policy": `default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors ${cockpitOrigin() ?? "'none'"}`,
  } });
}
// An app receives a purpose- and origin-bound credential, never the cockpit cookie.
export async function gateManagedApp(request: NextRequest, id: ManagedAppId): Promise<NextResponse | null> {
  if (request.nextUrl.pathname === "/__mso_app_bootstrap.js") return request.method === "GET" ? response(SCRIPT, 200, "application/javascript; charset=utf-8") : response(null, 404);
  if (request.nextUrl.pathname === "/__mso_app_auth") {
    if (request.method !== "POST" || request.headers.get("origin") !== managedAppOrigin(id)) return response(null, 403);
    const token = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    const secret = process.env.OS_SESSION_SECRET ?? "";
    const session = token ? verifyManagedAppSession(id, token, secret, "ticket") : null;
    if (!session || !await liveSessionAuthorized(session, "operator")) return response(null, 401);
    const result = response(null, 204);
    result.cookies.set(MANAGED_APP_SESSION_COOKIE, createManagedAppCookie(id, session, secret), { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: COOKIE_TTL / 1000 });
    return result;
  }
  if (await managedAppSession(request, id)) return null;
  if (request.method !== "GET" || request.headers.get("sec-fetch-dest") !== "iframe" && request.headers.get("sec-fetch-dest") !== "document") return response(null, 401);
  return response('<!doctype html><meta charset="utf-8"><title>MSO application authorization</title><body><p>Authorizing application...</p><script src="/__mso_app_bootstrap.js" defer></script></body>', 200, "text/html; charset=utf-8");
}

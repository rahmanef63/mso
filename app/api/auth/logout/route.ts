import { NextResponse } from "next/server";
import { SESSION_COOKIE, getSessionActor } from "@/lib/auth/require-session";
import { hostOnlyClearHeader, sessionCookieAttrs } from "@/lib/auth/session-cookie";
import { audit } from "@/lib/host/audit-api";

export const runtime = "nodejs";

export async function POST(req: Request) {
  audit({ action: "auth.logout", actor: await getSessionActor(), ok: true });
  const res = NextResponse.json({ success: true });
  // Same attributes as login, Max-Age=0 — a clear only matches a cookie with the
  // same Domain, so the two paths must read the same config or logout silently
  // leaves the session cookie alive.
  const attrs = sessionCookieAttrs(req, 0);
  res.cookies.set(SESSION_COOKIE, "", attrs);
  // When a Domain is configured, also kill the host-only cookie of the same name
  // that every pre-existing session still holds: distinct jar entry, unaffected
  // by the clear above, and still valid until natural expiry.
  if (attrs.domain) res.headers.append("set-cookie", hostOnlyClearHeader(SESSION_COOKIE));
  return res;
}

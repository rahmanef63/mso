import { sessionCookieDomain } from "@/lib/auth/session-cookie";

/** A different origin is not enough: cookies are domain scoped, never port scoped.
 * Registry review is presentation approval, not permission to receive MSO credentials. */
export function externalSurfaceSharesSession(origin: string, cockpitOrigins: string[]): boolean {
  let target: URL;
  try { target = new URL(origin); } catch { return true; }
  const hostname = (url: URL) => url.hostname.replace(/\.$/, "").toLowerCase();
  const cockpits = cockpitOrigins.flatMap(value => {
    try { return [new URL(value)]; } catch { return []; }
  });
  // Exact cockpit navigation is allowed; consumers still refuse to frame it.
  if (cockpits.some(url => url.origin === target.origin)) return false;
  if (cockpits.some(url => hostname(url) === hostname(target))) return true;
  // Reuse the actual validated cookie-domain authority, including legacy leading dots.
  return sessionCookieDomain(new Request(target, { headers: { host: hostname(target) } })) !== undefined;
}

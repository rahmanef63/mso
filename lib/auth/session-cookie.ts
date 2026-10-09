// Cockpit sessions are always host-only. The legacy Domain is retained only
// for logout cleanup; policy scope changes invalidate previously widened tokens.

/** One DNS label: 1-63 chars, alphanumeric, inner hyphens allowed. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// A malformed value must fail closed to host-only rather than reach the header:
// junk in Domain either forges extra attributes (`; Path=/` smuggled in) or, far
// more likely, makes the browser drop the whole Set-Cookie — login would answer
// 200 with no session and no error, an unexplainable login loop. Single-label
// values ("localhost", "com") are refused too: we have no Public Suffix List
// here, and a public suffix in Domain is rejected by browsers anyway.
function isCookieDomain(value: string): boolean {
  if (!value || value.length > 253) return false;
  if (/^[0-9.]+$/.test(value)) return false; // IPv4 — Domain is invalid for IPs
  const labels = value.split(".");
  return labels.length >= 2 && labels.every((label) => LABEL.test(label));
}

/** RFC 6265 §5.1.3 domain-match, minus the IP case (refused above). */
function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The host the browser addressed, normalised: no port, no trailing dot. */
function requestHostname(req: Request): string {
  // Host first, X-Forwarded-Host second — the latter is client-settable, and it
  // is only consulted to DECIDE whether to widen. Spoofing it can at worst make
  // the spoofer's own cookie host-only or unusable; it cannot widen the domain
  // beyond the validated env value.
  const raw = req.headers.get("host") ?? req.headers.get("x-forwarded-host") ?? "";
  return raw.split(",")[0].trim().split(":")[0].replace(/\.$/, "").toLowerCase();
}

/** Stable signature scope for every browser session minted under this config.
 * Changing the cookie Domain invalidates existing signed sessions, including a
 * broader Domain cookie the browser may retain until its original expiry. */
export function configuredSessionCookieScope(): string {
  return "host";
}

// Retained only to clear cookies issued before host-only authorization.
function legacySessionCookieScope(): string {
  const raw = process.env.OS_SESSION_COOKIE_DOMAIN?.trim().toLowerCase() ?? "";
  const domain = raw.startsWith(".") ? raw.slice(1) : raw;
  return isCookieDomain(domain) ? `domain:${domain}` : "host";
}

/** The validated Domain for this request, or undefined for host-only. */
export function sessionCookieDomain(req: Request): string | undefined {
  const scope = legacySessionCookieScope();
  if (!scope.startsWith("domain:")) return undefined;
  const domain = scope.slice("domain:".length);
  const host = requestHostname(req);
  return host && domainMatches(host, domain) ? domain : undefined;
}

export type SessionCookieAttrs = {
  httpOnly: true;
  secure: true;
  sameSite: "strict";
  path: "/";
  maxAge: number;
  domain?: string;
};

/** Attributes for both writing (maxAge = lifetime) and clearing (maxAge = 0). */
export function sessionCookieAttrs(req: Request, maxAge: number): SessionCookieAttrs {
  const domain = maxAge === 0 ? sessionCookieDomain(req) : undefined;
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge,
    ...(domain ? { domain } : {}),
  };
}

/**
 * A second, host-only clear for logout. A host-only cookie and a Domain cookie
 * of the same name are DISTINCT jar entries (RFC 6265 §5.3 keys on name +
 * domain + host-only-flag + path), so clearing with Domain misses every session
 * issued before the domain was configured. Handed back as a raw header because
 * Next's ResponseCookies is keyed by name alone: a second `.set()` replaces the
 * first instead of emitting a second Set-Cookie.
 */
export function hostOnlyClearHeader(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

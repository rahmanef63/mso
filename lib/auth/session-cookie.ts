// Attributes of the `session` cookie, in ONE place so the SET (login) and CLEAR
// (logout) paths cannot drift. A cookie cleared without the same Domain leaves
// the original alive in the jar — a logout that does not log out.
//
// Default (OS_SESSION_COOKIE_DOMAIN unset) = host-only, exactly as before: no
// Domain attribute, so the cookie goes back only to the host that set it. That
// stays the default for dev, demo and the rollback path.
//
// Setting it widens the cookie to a domain AND every subdomain of it. The only
// reason to do that is the split-origin managed-app hosts (`hermes.os.…`,
// `openclaw.os.…`) — separate ORIGINS served by this same process, so the
// framed dashboard's requests are authenticated by the same session. It is one
// half of a pair with NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE + the middleware
// host gating; without that gating the session reaches every host under the
// domain and each one exposes the full cockpit API. See .env.example.
//
// Deliberately NOT named `__Host-session`: that prefix forbids Domain outright
// (the browser rejects such a Set-Cookie), so the prefix and this env var are
// mutually exclusive. Renaming the cookie to a `__Host-` prefix means deleting
// this module and the split-origin cookie plan with it.
//
// SameSite stays "strict" and the cross-origin iframe does NOT need it loosened:
// SameSite is evaluated per SITE — scheme + registrable domain — not per origin.
// `mso.example.com` and `hermes.mso.example.com` share the registrable domain
// `example.com` on the same scheme, so the frame's navigation and every
// subresource it fetches are same-site (RFC 6265bis §5.2); for a nested document
// the "site for cookies" is non-null when the top-level document and every
// ancestor are same-site with it, which holds here. Cross-ORIGIN (what the
// window.top opacity needs) is not cross-SITE (what SameSite gates). Only moving
// an app host to a different registrable domain would force a change.

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

/**
 * The validated Domain for this request, or undefined for host-only.
 * A Domain the request host does not domain-match would be dropped by the
 * browser, so that case degrades to host-only instead of shipping a dead cookie.
 */
export function sessionCookieDomain(req: Request): string | undefined {
  const raw = process.env.OS_SESSION_COOKIE_DOMAIN?.trim().toLowerCase() ?? "";
  // A leading dot is legacy syntax and ignored by RFC 6265 §5.2.3; normalise
  // rather than reject, since operators still write it out of habit.
  const domain = raw.startsWith(".") ? raw.slice(1) : raw;
  if (!isCookieDomain(domain)) return undefined;
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
  const domain = sessionCookieDomain(req);
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

// Baseline response headers for every MSO response.
//
// These used to come from next.config.mjs `headers()`. The Svelte cutover deleted
// that file and nothing replaced it, so the passive ZAP baseline on production
// started failing closed on 10021 (X-Content-Type-Options), 10035 (HSTS) and 10063
// (Permissions-Policy) for the document, immutable chunks and 404s alike.
//
// Applied at the single point where a Response leaves the server, so a route that
// already set its own value keeps it (the noVNC viewer deliberately sends a
// narrower Permissions-Policy), and a route that set nothing still gets the
// baseline. Permissions denied here are unused by the app; clipboard-write stays
// because the copy buttons call navigator.clipboard.writeText.
export const BASELINE_SECURITY_HEADERS = Object.freeze({
  "x-content-type-options": "nosniff",
  // TLS-only control plane. includeSubDomains omitted on purpose: not every
  // configured cookie-domain subdomain is HTTPS-only.
  "strict-transport-security": "max-age=31536000",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), clipboard-write=(self)",
  // Private control plane even when reached through a temporary HTTPS tunnel.
  "x-robots-tag": "noindex, nofollow, noarchive",
});

/** Mutates and returns `headers`, filling only names the response did not set. */
export function applyBaselineSecurityHeaders(headers) {
  for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}

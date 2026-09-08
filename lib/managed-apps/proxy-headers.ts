// Header plumbing for the managed-app reverse proxy (the [[...path]] route).
// Lives here so the cookie-isolation rules are unit-testable without Next.
//
// Cookie model: every cookie crossing the boundary is namespaced per app AND
// pinned to that app's proxy path. An upstream (Hermes, OpenClaw) therefore can
// neither read nor overwrite the mso `session` cookie — which is unprefixed
// and Path=/ — nor a sibling managed app's cookies.

// `authorization` is deliberately NOT forwarded and `www-authenticate` is
// deliberately NOT returned: together they turn the proxy into a credential
// relay — an upstream Basic challenge would make the browser prompt on the
// mso origin and then preemptively attach that Authorization header to other
// mso paths, which we would forward onward.
const REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "range",
  "if-none-match",
  "if-modified-since",
  "x-requested-with",
];

// Per-app additions to the list above. Kept separate because each entry IS one
// upstream's credential and no other upstream has any use for it.
//
// Hermes on a loopback bind mints an ephemeral session token per process, injects it
// into the SPA HTML (`window.__HERMES_SESSION_TOKEN__`) and requires it back on every
// /api/* fetch as `X-Hermes-Session-Token` — see _require_token in web_server.py.
// Dropping it renders the shell perfectly and 401s every request it makes, which is
// exactly what the dashboard did here: sidebar, no data.
//
// Safe to forward, unlike `authorization`: no browser ever attaches this header on its
// own, so it cannot become ambient credential. Only the app's own JS sets it, only on
// its own host, and a cross-origin fetch carrying it would need a CORS preflight the
// upstream does not answer.
const APP_REQUEST_HEADERS: Record<string, readonly string[]> = {
  hermes: ["x-hermes-session-token"],
};

// Frame-blocking and policy headers are absent by construction: no
// `x-frame-options`, `content-security-policy` or `permissions-policy` entry, so
// an upstream cannot un-frame itself (OpenClaw sends `X-Frame-Options: DENY` +
// `frame-ancestors 'none'`) nor override the policy the route sets itself. The
// upstream policy is not echoed but it is not ignored either — proxy-csp.ts
// intersects it into ours, so its hardening survives without its frame rules.
const RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "content-range",
  "accept-ranges",
  "content-disposition",
  "vary",
];

// Cookie NAMESPACE, not a path. Load-bearing on an app host too: the cockpit
// session cookie now carries Domain=mso.example.com, so it IS sent to
// hermes.mso.example.com — and Hermes' own cookies are `hermes_session_at` /
// `_rt` / `_provider` / `_pkce` / `hermes_sso_attempt`, any of which could just as
// easily have been called `session` (OpenClaw sets none at all today).
export const cookiePrefix = (id: string): string => `mapp_${id}_`;

// Where the app is mounted on the COCKPIT origin. Every helper below takes the
// mount prefix as an optional argument defaulting to this, because on the app's
// OWN host it is root-mounted and the prefix is "" — cookies belong at Path=/,
// a Location needs no re-basing, and the app's root-absolute URLs already resolve.
export const proxyPrefix = (id: string): string => `/api/v1/managed-apps/${id}/proxy`;

// Browser → upstream: keep ONLY our namespaced cookies and restore the real
// names. Anything else (`session`, `mso-device`, …) never leaves the host.
export function upstreamCookieHeader(raw: string | null, prefix: string): string | null {
  if (!raw) return null;
  const out: string[] = [];
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name.startsWith(prefix) || name.length === prefix.length) continue;
    out.push(`${name.slice(prefix.length)}=${part.slice(eq + 1).trim()}`);
  }
  return out.length ? out.join("; ") : null;
}

// Referers arrive as the proxy URL; login/CSRF checks compare them against the
// upstream's own origin, so strip the proxy prefix and re-base.
function rewriteReferer(value: string, prefix: string, base: URL): string | null {
  try {
    const url = new URL(value);
    const rest = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : "";
    return new URL(`${rest || "/"}${url.search}`, base).toString();
  } catch {
    return null;
  }
}

/** The head for a WebSocket UPGRADE. Deliberately almost nothing: an upgrade is not
 *  a fetch, and the two apps behind this proxy want opposite things from it.
 *
 *  What is removed is what the cockpit must never lend an agent process.
 *  `OS_SESSION_COOKIE_DOMAIN` widens the cockpit session cookie to the app hosts, so
 *  the browser sends it here and Next forwarded it verbatim — a full cockpit session
 *  handed to a third party that has no use for it. The HTTP path has always stripped
 *  it; this is the socket path catching up.
 *
 *  What is deliberately NOT touched, and why each was tried and reverted:
 *   • the query string — Hermes' single-use `?ticket=` IS that socket's credential.
 *   • `origin` — rewriting it for EVERY app is wrong, and that is why this is keyed
 *     per app below. OpenClaw's allowlist branch matches the origin AS PRESENTED, so
 *     once an operator adds this app host to gateway.controlUi.allowedOrigins (the
 *     installer now does), presenting a loopback origin instead is precisely what
 *     would stop their fix from working. Hermes wants the opposite — see
 *     SOCKET_LOOPBACK_ORIGIN.
 *   • `x-forwarded-*` — dropping them would restore OpenClaw's "local client" trust,
 *     except Next re-adds `x-forwarded-host` after any override and its check is
 *     presence-based across the whole prefix. So it cannot work, and stripping the
 *     rest only makes the upstream's own audit log lie about who connected. */
// Apps that refuse an upgrade whose Host/Origin is not the address they bound.
// Hermes repeats its DNS-rebinding guard on the socket path (FastAPI runs no HTTP
// middleware for WebSocket routes), so `_ws_host_origin_reason` compares both
// headers against `bound_host` and closes 4403 on a mismatch — chat and the tool
// events feed then flap on "connection interrupted (code 1006)" forever while every
// ordinary fetch works. Rewriting is safe here precisely because it is NOT the
// credential: `?token=` in the query is, and that rides through untouched.
//
// OpenClaw is deliberately not in this set; see the `origin` note above.
const SOCKET_LOOPBACK_ORIGIN = new Set(["hermes"]);

export function upstreamSocketHeaders(incoming: Headers, id?: string, base?: URL): Headers {
  const headers = new Headers(incoming);
  headers.delete("cookie");
  headers.delete("authorization");
  if (id && base && SOCKET_LOOPBACK_ORIGIN.has(id)) {
    headers.set("host", base.host);
    headers.set("origin", base.origin);
  }
  return headers;
}

export function buildUpstreamHeaders(req: Request, base: URL, id: string, prefix = proxyPrefix(id)): Headers {
  const headers = new Headers();
  for (const key of [...REQUEST_HEADERS, ...(APP_REQUEST_HEADERS[id] ?? [])]) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  const cookie = upstreamCookieHeader(req.headers.get("cookie"), cookiePrefix(id));
  if (cookie) headers.set("cookie", cookie);
  if (req.headers.get("origin")) headers.set("origin", base.origin);
  const referer = req.headers.get("referer");
  if (referer) {
    const rewritten = rewriteReferer(referer, prefix, base);
    if (rewritten) headers.set("referer", rewritten);
  }
  return headers;
}

// Headers.get("set-cookie") collapses multiples into one comma-joined string
// that cannot be split back safely (Expires carries a comma). undici exposes
// getSetCookie(); fall back to the single value only when it is missing.
export function readSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetter.getSetCookie === "function") return withGetter.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

// Upstream → browser: namespace the name, pin Path to this app's proxy prefix,
// drop Domain. HttpOnly and Max-Age/Expires are kept as the upstream sent them
// (some dashboards read their own CSRF cookie from JS); SameSite is forced to
// Lax — the proxy is same-origin with the OS, so the iframe still sends it.
export function rewriteSetCookie(value: string, id: string, secure: boolean, prefix = proxyPrefix(id)): string | null {
  const semi = value.indexOf(";");
  const pair = (semi === -1 ? value : value.slice(0, semi)).trim();
  const eq = pair.indexOf("=");
  if (eq < 1) return null;
  const attrs = (semi === -1 ? "" : value.slice(semi + 1))
    .split(";")
    .map((attr) => attr.trim())
    .filter((attr) => attr && !/^(path|domain|samesite|secure)\b/i.test(attr));
  attrs.push(`Path=${prefix || "/"}`, "SameSite=Lax");
  if (secure) attrs.push("Secure");
  return [`${cookiePrefix(id)}${pair}`, ...attrs].join("; ");
}

// A Secure cookie is dropped outright over plain http, so mirror the hop the
// browser actually used (Traefik terminates TLS and forwards http internally).
export function isSecureRequest(req: Request): boolean {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase() === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function pickResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  for (const key of RESPONSE_HEADERS) {
    const value = upstream.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
}

// A 3xx that loses its Location leaves the iframe on a blank page, so same-origin
// hops are re-based onto the proxy prefix. Anything that resolves OFF the
// upstream origin is refused (null) rather than emitted: passing it through made
// the proxy an open redirect (`Location: //evil.example`, or `//127.0.0.1:1234`
// to a neighbouring loopback service), and it is a CSP bypass primitive too —
// CSP3 §6.6.2.6 stops matching the path component once the redirect count is
// non-zero, so one hop turns every path-scoped source here into an origin-wide
// one. Resolution is against `target` (the URL actually requested upstream), so
// a relative Location is judged from where the upstream really answered.
// Root-relative on purpose (RFC 7231 allows it): an absolute Location would have to
// be built from `req.url`, and under `next start --hostname 0.0.0.0` Next derives that
// from the bind address — every hop would emit `http://0.0.0.0:4005/…` and strand the
// frame. Relative keeps the browser's own origin, whatever it is.
export function rewriteLocation(raw: string, target: URL, base: URL, id: string, prefix = proxyPrefix(id)): string | null {
  let resolved: URL;
  try {
    resolved = new URL(raw, target);
  } catch {
    return null;
  }
  if (resolved.origin !== base.origin) return null;
  // Root-mounted (prefix ""), the path is emitted unchanged — but still only after
  // the same-origin test above, so a hop off the upstream is refused either way.
  return `${prefix}${resolved.pathname}${resolved.search}`;
}

// Service workers are the one thing a proxied bundle can leave behind: registered
// from proxied bytes they install on the MSO origin, scoped to this prefix,
// and keep answering fetches after the window is closed. OpenClaw's control UI
// does exactly that — `navigator.serviceWorker.register(new URL(ct('sw.js'), …))`
// where `ct()` derives its base from window.location.pathname, i.e. our prefix.
// Only dist/control-ui/sw.js ships today (Hermes' web_dist has no worker at all);
// the two aliases are free insurance against an upstream rename. `worker-src
// blob:` in the policy below is the real control — this 404 just means the script
// never even reaches the browser.
const SERVICE_WORKER_SCRIPTS = new Set(["sw.js", "service-worker.js", "serviceworker.js"]);

export function isServiceWorkerPath(segments: string[]): boolean {
  const last = segments.at(-1);
  return last !== undefined && SERVICE_WORKER_SCRIPTS.has(last.toLowerCase());
}

// The policy itself lives in proxy-csp.ts: building it needs node:crypto (it pins
// the injected shim by hash). Both modules are server-only — nothing under
// frontend/ imports either one.

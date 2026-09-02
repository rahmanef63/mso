// Next 16 renamed middleware.ts → proxy.ts. Three jobs:
//  1. Host → managed app: on a managed-app host (hermes.os.…, openclaw.os.…, from
//     NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE) EVERY path is rewritten into that
//     app's proxy route, so the dashboard is root-mounted at "/" on its own origin
//     and the cockpit — pages, /api/v1/exec, /api/auth/* — does not exist there.
//     That gating is what makes the widened session cookie (Domain=mso.rahmanef.com)
//     safe to hand to those hosts.
//  2. CSRF depth-2 for mutating /api — every /api route already verifies the
//     signed session cookie via requireSession(); this adds the second factor
//     (mutating /api must come from our own origin), because those endpoints are
//     literal host shell and the SameSite=Strict cookie is a single point.
//  3. A per-request nonce + Content-Security-Policy on the HTML document. The app
//     is PUBLIC and renders untrusted host content (fs bytes, terminal output),
//     so a strict script-src is the XSS→host-RCE containment layer. Next reads
//     the nonce from the REQUEST content-security-policy header and auto-nonces
//     its own bootstrap + RSC inline scripts; x-nonce is our channel for the
//     hand-written theme-noflash script in app/layout.tsx.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  MANAGED_APP_HOST_HEADER,
  isUnclaimedAppNamespaceHost,
  managedAppIdForHost,
} from "@/lib/managed-apps/origin";
import {
  proxyPrefix,
  upstreamSocketHeaders,
} from "@/lib/managed-apps/proxy-headers";
import { getManagedAppDefinition } from "@/lib/managed-apps/catalog";
import { projectIngressDecision } from "@/lib/managed-apps/project-ingress";
import { verifySession } from "@/lib/auth/session";
import { getApprovedDevice } from "@/lib/auth/device-store";
import { roleAtLeast, type DeviceRole } from "@/lib/auth/roles";
import { IS_DEMO } from "@/lib/demo";
import { camoufoxViewerCsp, isCamoufoxViewerHost } from "@/lib/camoufox/origin";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// `Upgrade` is a comma-separated token list, so a substring test would also match
// a header naming some other protocol.
const WEBSOCKET_UPGRADE = /(?:^|,)\s*websocket\s*(?:,|$)/i;

// Mirrors SESSION_COOKIE in lib/auth/require-session.ts. Not imported from there:
// that module pulls in next/headers, which middleware cannot use.
const SESSION_COOKIE = "session";

// Only loopback. dashboardUrl comes from HERMES_DASHBOARD_URL / OPENCLAW_DASHBOARD_URL,
// and the upgrade hop below is the one place a rewrite leaves this server — an env
// typo pointing it off-box would turn the cockpit into an open socket relay.
const LOOPBACK_HOST =
  /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\]|::1|localhost)$/i;

// noVNC + websockify for the Camoufox browser session (scripts/camoufox-vnc-service
// serves it). Loopback-checked at the rewrite, same as the managed-app dashboards.
const CAMOUFOX_NOVNC_URL =
  process.env.CAMOUFOX_NOVNC_URL ?? "http://127.0.0.1:6080";

// The same read require-session.ts does, minus next/headers: verify EVERY `session=`
// cookie and accept the first that both holds up and is still an approved device.
// Cookies are not isolated by port or path (RFC 6265 §8.5), so document.cookie on the
// same host can add a second one that sorts ahead of the real one; checking only the
// first would let a forged value decide. Revocation is re-checked here too — a valid
// HMAC alone must not outlive the device being removed.
async function hasApprovedSession(
  request: NextRequest,
  minimumRole: DeviceRole = "viewer",
): Promise<boolean> {
  if (IS_DEMO) return false;
  const secret = process.env.OS_SESSION_SECRET ?? "";
  for (const { value } of request.cookies.getAll(SESSION_COOKIE)) {
    const payload = verifySession(value, secret);
    if (!payload?.device_id) continue;
    const device = await getApprovedDevice(payload.device_id);
    if (device && roleAtLeast(device.role, minimumRole)) return true;
  }
  return false;
}

// Paths the matcher used to exclude. A matcher cannot exclude by HOST and /_next/*
// must be blockable on an app host, so they reach middleware now and are waved
// through here instead — identical outcome on the cockpit (no nonce, no policy, no
// per-asset work). Prefix semantics kept exactly as the old negative lookahead's.
const MATCHER_EXCLUDED = /^\/(?:_next\/static|_next\/image|favicon\.ico)/;

function blocked() {
  return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
}

// Nothing but that app's own surface exists on an app host, and the app is not
// Next: no dashboard serves /_next/*, it is only ever the cockpit's namespace.
function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// Extracted so the app-host branch can apply the SAME rule: after its rewrite the
// path starts with /api/, i.e. past the point where this gate would have run.
function crossOriginMutation(request: NextRequest): boolean {
  // Sec-Fetch-Site is a forbidden header — when present it is authoritative.
  const site = request.headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  // Older/non-browser clients: Origin host match, else require the cookie.
  const origin = request.headers.get("origin");
  if (origin) {
    const expected =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      request.nextUrl.host;
    try {
      return new URL(origin).host !== expected;
    } catch {
      return true;
    }
  }
  return !request.cookies.get("session");
}

// Per-directive rationale (verified against real usage):
// - script-src: nonce (Next bootstrap/RSC/theme) + strict-dynamic (nonced
//   bootstrap pulls /_next chunks) + wasm-unsafe-eval (@imgly onnxruntime WASM).
// - style-src 'unsafe-inline': radix/konva/react + next/font inline styles;
//   ignored for scripts once a nonce is present (CSP3), so no XSS weakening.
// - img-src https:: quicklink favicons hit www.google.com directly + the stock
//   picker renders arbitrary Openverse/Unsplash hosts + "paste any image URL".
// - connect-src stays TIGHT (self + @imgly host): all AI/BYOK/stock/oauth fetches
//   are SERVER-side, so the browser only hits same-origin /api — the exfil gate.
// - frame-src https:: media-viewer PDF + widget "Embed" + app-store runtime iframes
//   load external URLs (each sandboxed). worker/child blob: = SW + onnx worker.
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://staticimgly.com blob: data:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "media-src 'self' blob: data:",
    "frame-src 'self' https: blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Which app host this is, if any. The HOST header is authoritative and
  // x-forwarded-host is deliberately NOT consulted here: Traefik routes on Host
  // with passHostHeader:true, so Host is the public name the router already
  // matched, while x-forwarded-host is a second, client-settable name for the same
  // thing. Letting the two disagree is the whole risk — a request on an app host
  // that could claim the cockpit host would escape the rewrite below and reach
  // /api/v1/exec with a session cookie that is now sent to that host. The opposite
  // lie (claiming an app host while on the cockpit) only restricts the request.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const managedApp = managedAppIdForHost(host);

  // noVNC gets one reserved split-origin host. Every path on it goes ONLY to the
  // loopback viewer; no cockpit route exists there. The Domain session cookie is
  // used solely at this edge gate and is stripped before noVNC receives the request.
  if (isCamoufoxViewerHost(host)) {
    if (!(await hasApprovedSession(request, "operator"))) return notFound();
    if (request.method !== "GET" && request.method !== "HEAD")
      return notFound();
    let base: URL;
    try {
      base = new URL(CAMOUFOX_NOVNC_URL);
    } catch {
      return notFound();
    }
    if (
      (base.protocol !== "http:" && base.protocol !== "https:") ||
      !LOOPBACK_HOST.test(base.hostname)
    ) {
      return notFound();
    }
    const target = new URL(base);
    // Assign pathname/search separately: resolving a caller path beginning `//`
    // against base would otherwise change the destination host.
    target.pathname = pathname === "/" ? "/vnc.html" : pathname;
    target.search = request.nextUrl.search;
    const response = NextResponse.rewrite(target, {
      request: { headers: upstreamSocketHeaders(request.headers) },
    });
    response.headers.set("Content-Security-Policy", camoufoxViewerCsp());
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()",
    );
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
    return response;
  }

  // Optional project integrations may expose ONE exact machine-to-machine POST
  // lane on a managed-app host. Stock MSO has no routes because
  // OS_PROJECT_INGRESS_ROUTES defaults to empty. The route config is fixed by the
  // operator, targets loopback only, and the upstream still verifies the real
  // HMAC secret; this edge check only rejects obvious public garbage before CSRF.
  const ingress = projectIngressDecision(request, managedApp, pathname);
  if (ingress.matched) {
    if (!ingress.target) return blocked();
    return NextResponse.rewrite(new URL(ingress.target));
  }

  // A host inside the app namespace that is NOT an app (a new `X.mso.rahmanef.com`
  // record, or a `*.os` wildcard) must not serve the cockpit: the session cookie is
  // widened to that name, so such a host would be same-origin with a fully
  // authenticated cockpit — the reach the split exists to remove, re-opened by a DNS
  // edit alone. The parent itself (the cockpit) is never matched, so this cannot
  // lock the operator out.
  if (!managedApp && isUnclaimedAppNamespaceHost(host)) return notFound();

  if (managedApp) {
    // Before the rewrite, or it never runs. Legitimate traffic is unaffected: the
    // frame's own fetch/XHR and its form posts are same-origin with the app host.
    // Cockpit JS reaching an app host is only SAME-SITE, so it is blocked — and
    // that reach is exactly what the origin split exists to remove.
    if (MUTATING.has(request.method) && crossOriginMutation(request))
      return blocked();
    if (pathname === "/_next" || pathname.startsWith("/_next/"))
      return notFound();

    // A WebSocket upgrade. A route handler cannot service one — which is why every
    // OpenClaw panel sat dead and its windows opened on a terminal instead — but a
    // rewrite is not always internal: when the destination origin differs from the
    // one Next derived for this request, Next PROXIES it, and its proxy carries the
    // upgrade (101 + both pipes). That is the same fork the comment below relies on
    // to keep the ordinary rewrite internal; here we want the other side of it.
    //
    // The upgrade never reaches the proxy route, so the route's verifyAuth() never
    // runs and NOTHING below this line protects the socket. Hence the session check
    // right here: without it this is an unauthenticated relay from the public
    // internet into the agent's gateway.
    //
    // The head is the same for both apps, and that took a wrong turn to establish:
    // Hermes and OpenClaw do want opposite things, but neither difference survives as
    // a header. See upstreamSocketHeaders for what was tried and why it was reverted.
    // What genuinely differs between them is READINESS, and that already lives per-app
    // in feature-cli.ts. The query string is passed verbatim — Hermes' `?ticket=` is
    // that socket's entire credential.
    if (WEBSOCKET_UPGRADE.test(request.headers.get("upgrade") ?? "")) {
      if (!(await hasApprovedSession(request, "operator"))) return notFound();
      const base = new URL(getManagedAppDefinition(managedApp).dashboardUrl);
      if (!LOOPBACK_HOST.test(base.hostname)) return notFound();
      return NextResponse.rewrite(
        new URL(`${pathname}${request.nextUrl.search}`, base),
        {
          request: {
            headers: upstreamSocketHeaders(request.headers, managedApp, base),
          },
        },
      );
    }

    const headers = new Headers(request.headers);
    // set(), not append(): this overwrites whatever copy the client sent.
    headers.set(MANAGED_APP_HOST_HEADER, managedApp);
    // No trailing slash: "/" must become the prefix itself. Next 308-redirects a
    // trailing slash away before middleware even runs, and re-adding one here would
    // send that redirect back to this host to be rewritten a second time, one prefix
    // deeper. Two traps in building this URL:
    //  • the origin must be the one NEXT derived for this request (nextUrl's: bind
    //    host + x-forwarded-proto, NOT the public Host). A rewrite stays internal
    //    only while the destination's origin matches that; otherwise Next PROXIES
    //    the destination — i.e. opens an https socket to this server's plain http
    //    port and dies with EPROTO. `next start --hostname 0.0.0.0` (how the unit
    //    starts it) agrees with itself here; `--hostname 127.0.0.1` does NOT, and
    //    every rewrite 500s under it.
    //  • a plain URL, not nextUrl.clone(): NextURL remembers the incoming trailing
    //    slash and puts it back when the pathname is reassigned.
    const path = `${proxyPrefix(managedApp)}${pathname.replace(/\/+$/, "")}`;
    return NextResponse.rewrite(
      new URL(`${path}${request.nextUrl.search}`, request.nextUrl.origin),
      {
        request: { headers },
      },
    );
  }

  if (MATCHER_EXCLUDED.test(pathname)) return NextResponse.next();

  // Machine-to-machine protocol surfaces are JSON/SSE, not HTML, and are reached
  // cross-origin by design. They live outside /api deliberately: browser-cookie
  // CSRF is the wrong control because MCP and inbound A2A authenticate with explicit
  // bearer credentials that a browser never attaches on its own. The A2A Agent Card
  // is public discovery metadata, while /a2a/v1 verifies its bearer before dispatch.
  // Treat all of them like /api for response policy: no nonce, no document CSP.
  // NOTE /oauth/authorize is NOT here on purpose — it is a real HTML consent page
  // and must keep the nonce + document CSP. Only machine protocol endpoints are listed.
  const isMcp =
    pathname === "/mcp" ||
    pathname.startsWith("/.well-known/oauth-") ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/register";
  const isA2A =
    pathname === "/a2a/v1" || pathname === "/.well-known/agent-card.json";
  const isMachineProtocol = isMcp || isA2A;
  const isApi = pathname.startsWith("/api/") || isMachineProtocol;
  // The historical same-origin bridge is permanently closed. noVNC is executable
  // third-party code and is served only from its reserved split-origin host above.
  if (pathname.startsWith("/camoufox-vnc/")) return notFound();

  // CSRF depth-2 for mutating owner/browser APIs. Machine protocols are excluded:
  // their explicit bearer authentication is authoritative, while same-origin proof
  // would break legitimate remote MCP/A2A clients. /api/v1/a2a stays protected
  // because it is the owner management API, not the A2A protocol endpoint.
  if (
    MUTATING.has(request.method) &&
    isApi &&
    !isMachineProtocol &&
    crossOriginMutation(request)
  )
    return blocked();

  // /api owns its own response headers (fs/raw sets `content-security-policy:
  // sandbox`, Cache-Control no-store) and serves no inline scripts — never stamp
  // the document CSP on it.
  if (isApi) {
    // An inbound copy of the app-host header would let a request on the COCKPIT
    // origin claim root-mounted mode at the old same-origin proxy URL — the exact
    // hole this split closes. Cloned only when there is something to strip, so the
    // ordinary path stays byte-for-byte as it was.
    if (request.headers.has(MANAGED_APP_HOST_HEADER)) {
      const stripped = new Headers(request.headers);
      stripped.delete(MANAGED_APP_HOST_HEADER);
      return NextResponse.next({ request: { headers: stripped } });
    }
    return NextResponse.next();
  }

  // Per-request nonce for the HTML document. Edge-safe (crypto + btoa, no
  // Buffer). Next reads the nonce from the REQUEST content-security-policy header
  // and auto-nonces its bootstrap + RSC scripts; x-nonce feeds our layout script.
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(MANAGED_APP_HOST_HEADER);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Everything: an app host has to be gated on the paths the old negative lookahead
// excluded (/_next/static, /_next/image, favicon.ico) and a rewrite cannot fire for
// a path middleware never sees — a Traefik-level block is not available. The
// cockpit short-circuits those in MATCHER_EXCLUDED above.
export const config = {
  matcher: ["/(.*)"],
};

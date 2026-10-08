import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { getManagedAppDefinition, isManagedAppId } from "@/lib/managed-apps/catalog";
import { managedAppUpstream } from "@/lib/managed-apps/upstream-target";
import {
  MANAGED_APP_HOST_HEADER,
  cockpitOrigin,
  managedAppOrigin,
  splitOriginEnabled,
} from "@/lib/managed-apps/origin";
import { contentSecurityPolicy } from "@/lib/managed-apps/proxy-csp";
import { errorPage, wantsErrorPage } from "@/lib/managed-apps/proxy-error-page";
import {
  buildUpstreamHeaders,
  isSecureRequest,
  isServiceWorkerPath,
  pickResponseHeaders,
  readSetCookies,
  rewriteLocation,
  rewriteSetCookie,
} from "@/lib/managed-apps/proxy-headers";

export const dynamic = "force-dynamic";

const BODY_LIMIT = 1_000_000;

// next.config stamps `X-Frame-Options: DENY` on every path, and a JSON error carries
// no CSP of its own — so without `frame-ancestors` the browser refuses to DISPLAY the
// route's own errors in the app window and the user sees a blank frame instead of
// "unauthorized" or "upstream unavailable". frame-ancestors makes browsers ignore XFO.
//
// Split mode: 'self' here resolves to the APP host, and the framer is the cockpit — a
// different origin now — so it has to be named as well, or the errors this header
// exists to surface are exactly the ones that stay invisible (stop a managed app and
// its 502 renders as a blank frame). Same source as the success path's policy:
// deployment env, never a request header.
function failAncestors(): string {
  const cockpit = splitOriginEnabled() ? cockpitOrigin() : null;
  return cockpit ? `'self' ${cockpit}` : "'self'";
}

// Same failure, two audiences, one policy. A navigation (the app window's own frame, or a
// tab) gets a page that says what to DO about it; the upstream SPA's fetches — which land
// on this very route — keep getting the JSON they parse. `wantsErrorPage` decides on
// Sec-Fetch-Dest, never on status, so no failure is readable in one caller and cryptic in
// the other. See proxy-error-page.ts for the case that made this worth the branch.
const fail = (req: Request, error: string, status: number) => {
  const headers: Record<string, string> = {
    "content-security-policy": `default-src 'none'; frame-ancestors ${failAncestors()}`,
  };
  if (!wantsErrorPage(req)) return NextResponse.json({ error }, { status, headers });
  headers["content-type"] = "text/html; charset=utf-8";
  return new NextResponse(errorPage(error, status), { status, headers });
};

// A chunked request has no content-length, so the header check alone would let an
// arbitrarily large body buffer into memory before the size test could reject it.
// This is the one route an untrusted upstream's JS can drive (its own fetches land
// here, root-mounted), so count as it streams and abort past the cap.
async function readBody(req: Request, limit: number): Promise<ArrayBuffer | null> {
  const reader = req.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new Blob(chunks as BlobPart[]).arrayBuffer();
}

async function proxy(req: Request, context: { params: Promise<{ id: string; path?: string[] }> }) {
  if (!(await verifyAuth(req))) return fail(req, "unauthorized", 401);
  const params = await context.params;
  if (!isManagedAppId(params.id)) return fail(req, "unknown managed application", 404);
  // The dashboard is served from its OWN host and nowhere else. The middleware
  // rewrite is invisible from in here, so it stamps the app host it matched — and it
  // deletes any inbound copy on every request, so the header can only have come from
  // middleware. Without the header we are on the cockpit origin, which is the
  // same-origin reach the split closes: 404 it, or the hole survives at the old URL.
  //
  // No app host configured = this deployment does not serve upstream dashboards at
  // all. Serving them under a path on the cockpit origin was the old fallback, and it
  // cannot be made safe: a CSP binds a realm, not a reference across realms, so
  // upstream JS reaches `window.top.fetch('/api/v1/exec')` from a frame and gets a
  // whole cockpit realm from `window.open('/')` in a tab. Only a separate origin
  // closes it, so without one the dashboards are not proxied — the feature windows
  // fall back to the CLI view and to opening the app in a browser of the user's own.
  if (!splitOriginEnabled()) return fail(req, "managed application dashboards are not served on this origin", 404);
  if (req.headers.get(MANAGED_APP_HOST_HEADER) !== params.id) return fail(req, "not found", 404);
  const appOrigin = managedAppOrigin(params.id);
  if (!appOrigin) return fail(req, "managed application origin is unavailable", 500);
  // On the app's own host the app IS the origin root — cookies at Path=/, Locations
  // unchanged, policy scoped to the origin. Deployment env (the host template), never
  // a request header: this URL is what every fetch directive is scoped to, so a
  // client-settable source would let the frame widen its own policy.
  const prefixUrl = `${appOrigin}/`;
  const segments = params.path ?? [];
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) {
    return fail(req, "invalid upstream path", 400);
  }
  // A service worker registered from proxied bytes installs on the MSO origin
  // and keeps serving after the window closes. Never hand one to the browser.
  if (isServiceWorkerPath(segments)) {
    return fail(req, "service workers are not proxied", 404);
  }
  const definition = getManagedAppDefinition(params.id);
  let base: URL;
  try { base = managedAppUpstream(definition.dashboardUrl); }
  catch { return fail(req, "upstream target is not loopback", 502); }
  const target = new URL(`/${segments.map(encodeURIComponent).join("/")}`, base);
  target.search = new URL(req.url).search;
  const headers = buildUpstreamHeaders(req, base, params.id, "");
  let body: ArrayBuffer | undefined;
  if (!['GET', 'HEAD'].includes(req.method)) {
    const length = Number(req.headers.get("content-length") ?? "0");
    if (length > BODY_LIMIT) return fail(req, "upstream request body too large", 413);
    const read = await readBody(req, BODY_LIMIT);
    if (read === null) return fail(req, "upstream request body too large", 413);
    body = read;
  }
  try {
    const upstream = await fetch(target, { method: req.method, headers, body, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(20_000) });
    // A login POST answers 302 + Set-Cookie, so the cookies must ride the
    // rewritten redirect too — not just plain 2xx bodies.
    const secure = isSecureRequest(req);
    const cookies = readSetCookies(upstream.headers)
      .map((raw) => rewriteSetCookie(raw, params.id, secure, ""))
      .filter((value): value is string => value !== null);
    const responseHeaders = pickResponseHeaders(upstream.headers);
    for (const cookie of cookies) responseHeaders.append("set-cookie", cookie);
    responseHeaders.set("x-managed-app", params.id);
    // Ours is the only policy the browser sees — the RESPONSE_HEADERS allowlist
    // copies neither the upstream CSP nor its x-frame-options. It is still fed IN:
    // contentSecurityPolicy intersects it, so OpenClaw's inline-script hashes and
    // narrow connect-src survive while its frame rules do not.
    responseHeaders.set(
      "content-security-policy",
      // The frame is CROSS-origin, so frame-ancestors must name the cockpit or the
      // browser refuses to display it at all.
      contentSecurityPolicy(prefixUrl, upstream.headers.get("content-security-policy"), {
        cockpitOrigin: cockpitOrigin(),
      }),
    );
    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location");
      if (location) {
        // Off-origin hops are refused, not relayed: emitting one makes this an
        // open redirect and, per CSP3 §6.6.2.6, drops path matching for every
        // source in the policy above from the first hop onward.
        const rewritten = rewriteLocation(location, target, base, params.id, "");
        if (rewritten === null) {
          // Refusal is a loopable path — release the socket instead of waiting for GC.
          void upstream.body?.cancel();
          return fail(req, "upstream redirect leaves the managed application", 502);
        }
        responseHeaders.set("location", rewritten);
        return new Response(null, { status: upstream.status, headers: responseHeaders });
      }
    }
    // No HTML/CSS rewriting: the app owns its host root, so `/assets/x.js`,
    // `next=/sessions` and `url(/fonts/y.woff2)` already resolve as the upstream
    // shipped them. Everything streams.
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return fail(req, "managed application upstream unavailable", 502);
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;

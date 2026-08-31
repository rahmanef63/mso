import { execSync } from "node:child_process";

// Build id baked into the client bundle so a redeploy can be detected.
const BUILD_ID =
  process.env.NEXT_PUBLIC_BUILD_ID ||
  process.env.NEXT_DEPLOYMENT_ID ||
  String(Date.now());

// WHICH COMMIT THIS BUILD IS, baked in at build time — the only way the running app
// can know it, since `git rev-parse HEAD` at runtime answers for the CHECKOUT, which
// moves whenever someone pulls. Settings → About compares the two: equal means the
// running build is current, different means a build is pending and the update panel
// offers the rebuild. Empty is fine and expected — scripts/verify-build.sh compiles
// a `git archive` export with no .git in it.
const COMMIT_SHA =
  process.env.NEXT_PUBLIC_COMMIT_SHA ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  })();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework/version — the shell is now public; minimize
  // the fingerprint an unauthenticated visitor can use for CVE matching.
  poweredByHeader: false,
  // Cache Components off: mso is a fully dynamic app (auth-gated OS shell,
  // no SSG marketing pages), so static prerendering adds no value and conflicts
  // with the auth provider's cookie reads. Re-enable only if static routes land.
  cacheComponents: false,
  // The Browser app renders site favicons via Google's s2 service (fixed host)
  // through next/Image, so the optimizer caches/resizes them. Host filesystem
  // images + the live Playwright screenshot stream stay raw <img> on purpose —
  // they're dynamic/auth'd bytes the optimizer can't help with.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.google.com", pathname: "/s2/favicons/**" },
    ],
  },
  // node-pty is a native addon (.node binary) — it must be require()'d from
  // node_modules at runtime, never bundled, or the binding fails to load.
  serverExternalPackages: ["node-pty"],
  // Only ever an EXPLICIT deployment id — never BUILD_ID. This config is evaluated
  // twice (once by `next build`, once when `next start` boots), so a Date.now()
  // fallback produced two different ?dpl= values for the same chunk: the HTML
  // referenced both variants and the browser downloaded, parsed and executed ~160 KB
  // gzip of entry chunks twice on every cold load. Chunks are content-hashed, so no
  // ?dpl= at all is correct.
  //
  // The key must be ABSENT, not undefined: `deploymentId: undefined` still counts as
  // set, and Next then appends a literal empty `?dpl=` — which leaves `chunk.js` and
  // `chunk.js?dpl=` as two distinct URLs and the double download intact. Hence the
  // conditional spread. BUILD_ID below is unaffected: it is inlined at build time and
  // the SW cache name + /api/health still need it.
  ...(process.env.NEXT_DEPLOYMENT_ID
    ? { deploymentId: process.env.NEXT_DEPLOYMENT_ID }
    : {}),
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID, NEXT_PUBLIC_COMMIT_SHA: COMMIT_SHA },
  experimental: {
    // proxy.ts clones request bodies; the default clone cap is 10MB, which
    // silently truncated large /api/v1/fs/upload payloads. Raise it so big
    // media uploads land intact (proxy* is the Next 16 name of the option).
    // Kept just above the upload route's 200 MiB running cap (which streams to
    // disk and returns 413 past it) so the route — not the proxy — owns rejection.
    proxyClientMaxBodySize: "256mb",
    // Tree-shake heavy icon/radix barrels — keeps the OS shell bundle lean.
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-popover",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-slider",
      "@radix-ui/react-tabs",
    ],
  },
  // Serve the service worker at /sw.js (stable scope) from the /api/sw route
  // handler. beforeFiles runs BEFORE page routing, so the optional catch-all
  // [[...slug]] never swallows /sw.js (a route under /api is never caught by it).
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/sw.js", destination: "/api/sw" },
        // NO camoufox rewrite here, deliberately. It used to live here and published
        // websockify (127.0.0.1:6080, x11vnc behind it) to the public origin with no
        // real gate. A config rewrite bypasses route handlers, so nothing downstream
        // can authenticate it — proxy.ts owns that hop now and rewrites it itself,
        // behind hasApprovedSession(). Do not add it back.
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Authenticated remote shell over HTTPS — refuse any plaintext leg so
          // a MITM can't strip TLS and capture the session cookie before the
          // redirect fires. 1 year. includeSubDomains omitted on purpose: not
          // every rahmanef.com subdomain is HTTPS-only.
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // MSO is a private control plane even when reached through a temporary HTTPS tunnel.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          // Public remote shell — never allow it to be framed (clickjacking on
          // exec/fs buttons). The full Content-Security-Policy (incl. a nonce'd
          // script-src) is set PER-REQUEST in proxy.ts so a fresh nonce can gate
          // inline scripts; a static CSP here can't nonce, so it's intentionally
          // omitted (proxy owns it).
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        source: "/camoufox-vnc/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      // Private API responses must never be cached by any intermediary — they
      // carry host bytes (fs/read), auth state, and per-session data.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // Named brand/wallpaper assets are effectively immutable but, unlike
      // /_next chunks, are NOT content-hashed — rename or add ?v= if ever redrawn.
      { source: "/wallpapers/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: "/icon.svg", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
      { source: "/icon-maskable.svg", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
    ];
  },
};
export default nextConfig;

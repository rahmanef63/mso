import { NextResponse } from "next/server";

// Serve the service worker dynamically so its bytes change every deploy: the
// CACHE name (and header comment) embed the build id. A static public/sw.js is
// byte-identical across deploys, so the browser never sees an "update" and the
// "new version → reload" toast never fires (it only ever showed once, during a
// cache-name bump). With the id baked in, each deploy is a new SW → updatefound
// → waiting → toast (see app/register-sw.tsx). Caches ONLY icons + manifest;
// never JS chunks/HTML, so a redeploy can't strand a stale chunk.
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

// Only bootstrap icons/manifest are pre-cached; artwork is cached on first use.
const BOOTSTRAP_ASSETS = ["/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest"];
const APP_ICON_ASSETS = [
  "assistant", "camoufox", "claude", "code", "create", "docs", "files",
  "hermes", "launchpad", "links", "mission-control", "monitor", "openclaw",
  "reel", "settings", "store", "studio", "terminal", "viewer",
].map((name) => `/app-icons/${name}.webp`);

const OFFICIAL_BRAND_ICON_ASSETS = [
  "/brand/official/camoufox.webp",
  "/brand/official/hermes.webp",
  "/brand/official/openclaw.webp",
];

const PLATFORM_APP_ICON_ASSETS = [
  "files", "terminal", "code", "monitor", "settings", "assistant", "camoufox", "store", "docs", "studio", "claude", "reel", "viewer", "create", "links", "hermes", "openclaw",
].flatMap((name) => [
  `/app-icons/macos/${name}.webp`,
  `/app-icons/windows/${name}.webp`,
]);

const FIRST_PARTY_PLATFORM_ASSETS = PLATFORM_APP_ICON_ASSETS.filter((asset) => !/\/(?:camoufox|hermes|openclaw)\.webp$/.test(asset));
const RESPONSIVE_ICON_ASSETS = [
  "/app-icons/launchpad.avif", "/app-icons/mission-control.avif",
  ...FIRST_PARTY_PLATFORM_ASSETS.flatMap((asset) => [asset.replace(".webp", "-128.webp"), asset.replace(".webp", ".avif")]),
  ...APP_ICON_ASSETS.filter((asset) => !/\/(?:camoufox|hermes|openclaw|launchpad|mission-control)\.webp$/.test(asset)).map((asset) => asset.replace(".webp", "-128.webp")),
];

const SW = `// mso service worker — build ${BUILD_ID}
const CACHE = "mso-${BUILD_ID}";
// The two names here until 2026-07-30 were "/icon-192.png" and "/icon-512.png", which
// do not exist and never did — app/manifest.ts has always pointed at the SVGs. Next's
// catch-all answers an unknown path with the app HTML and a 200, so addAll() did not
// throw; it quietly cached the HTML shell under two icon URLs, which is exactly what
// the comment above promises this never does.
const ASSETS = ${JSON.stringify([...BOOTSTRAP_ASSETS, ...APP_ICON_ASSETS, ...PLATFORM_APP_ICON_ASSETS, ...RESPONSIVE_ICON_ASSETS, ...OFFICIAL_BRAND_ICON_ASSETS])};
self.addEventListener("install", (e) => {
  // Do NOT skipWaiting here. Auto-activating skipped the "waiting" state, so the
  // client's "new version" toast (which needs reg.waiting) never showed and the
  // update relied on a silent controllerchange reload that did not fire on mobile
  // PWAs. Now the new SW sits in waiting → client toasts → user taps Reload →
  // SKIP_WAITING message (below) activates it → controllerchange reload. The
  // first-ever install (no old SW controlling clients) still activates at once.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(${JSON.stringify(BOOTSTRAP_ASSETS)}).catch(() => {})));
});
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!ASSETS.includes(url.pathname)) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      return hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; });
    }),
  );
});
`;

export function GET() {
  return new NextResponse(SW, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

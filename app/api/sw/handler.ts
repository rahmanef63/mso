import { NextResponse } from "next/server";

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || "dev";

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

const SW = `// mso service worker — build ${BUILD_ID}
const CACHE = "mso-${BUILD_ID}";
// The two names here until 2026-07-30 were "/icon-192.png" and "/icon-512.png", which
// do not exist and never did — app/manifest.ts has always pointed at the SVGs. Next's
// catch-all answers an unknown path with the app HTML and a 200, so addAll() did not
// throw; it quietly cached the HTML shell under two icon URLs, which is exactly what
// the comment above promises this never does.
const ASSETS = ${JSON.stringify(["/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest", ...APP_ICON_ASSETS, ...PLATFORM_APP_ICON_ASSETS, ...OFFICIAL_BRAND_ICON_ASSETS])};
self.addEventListener("install", (e) => {
  // Do NOT skipWaiting here, and nothing on the client sends SKIP_WAITING either.
  // The new worker stays in waiting until the browser retires the old one (all
  // tabs closed) or the user reloads, so a deploy never swaps assets mid-session.
  // The update itself is surfaced only in Settings, which reads the release tag.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
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

export function handleGetSw(): NextResponse {
  return new NextResponse(SW, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

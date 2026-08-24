import { managedAppOrigin } from "@/lib/managed-apps/origin";
import type { ManagedAppFeature, ManagedAppId } from "@/lib/managed-apps/types";

/** ONE window per managed app, opened on the vendor SPA root.
 *
 *  MSO used to scrape each upstream's built bundle and spawn a window per nav route.
 *  That is gone: both dashboards ship their own sidebar, so re-hosting their navigation
 *  was work with no payoff and six regexes against minified third-party JS holding it up.
 *  The window shows the app; the app shows its own menu. */
export function dashboardFeature(id: ManagedAppId, title: string): ManagedAppFeature {
  return { id: `${id}:overview`, applicationId: id, title, route: "/", source: "nav-bundle", available: true };
}

/** Safe read-only command shown when switching a managed-app window to CLI.
 *  Hermes/OpenClaw expose `status`. 9Router does NOT: its upstream CLI starts the
 *  server when invoked, while MSO manages the Docker runtime, so auto-running it
 *  would race the container for port 20128. Docker logs are the useful read-only
 *  server CLI surface and leave the terminal interactive afterwards. */
export function cliCommand(feature: ManagedAppFeature): string {
  if (feature.applicationId === "9router") return "docker logs --tail 80 9router";
  return `${feature.applicationId} status`;
}

/** Where this app's dashboard is served from — the iframe `src` and the open-in-a-tab
 *  link, which must agree — or null when this deployment serves no dashboard at all.
 *
 *  The app's OWN host, ROOT-mounted: `proxy.ts` rewrites every path on that host into this
 *  app's proxy, so `/chat` there IS the proxy route, no path prefix. Root-mounting is why
 *  no HTML/CSS rewriting is needed — the upstream's own URLs resolve as shipped. Hermes
 *  emits them root-absolute (`/assets/x.js`, `next=/sessions`); OpenClaw emits them
 *  `./`-relative with no <base>, which survives its nested routes because its static
 *  handler answers /assets at any path depth.
 *
 *  Without a host template there is NO fallback to a path on the cockpit origin. That mode
 *  put upstream JS in a realm holding the user's session, where `window.top.fetch` and
 *  `window.open('/')` both reach /api/v1/exec and no header can intervene. A deployment
 *  that cannot give each app its own origin does not show the vendor UI. */
export function featureSource(feature: ManagedAppFeature): string | null {
  const origin = managedAppOrigin(feature.applicationId);
  return origin ? `${origin}/${feature.route.replace(/^\/+/, "")}` : null;
}

/** Pick the browser surface without confusing availability with preference.
 * A configured split-origin host is the primary UI because it can be embedded safely in
 * the MSO feature shell. A direct public-IP URL is only the no-domain fallback. */
export function dashboardSurfaceSource(
  embeddedSource: string | null,
  publicDashboardUrl: string | null | undefined,
): { source: string | null; kind: "embedded" | "direct" | "none" } {
  // An explicit HTTPS app domain is already a safe separate origin and usually carries
  // the app's existing cookies/session, so do not invent a second MSO subdomain for it.
  if (publicDashboardUrl?.startsWith("https://")) return { source: publicDashboardUrl, kind: "embedded" };
  if (embeddedSource) return { source: embeddedSource, kind: "embedded" };
  if (publicDashboardUrl) return { source: publicDashboardUrl, kind: "direct" };
  return { source: null, kind: "none" };
}

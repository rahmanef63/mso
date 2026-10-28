import { sessionAppForHost, shellAppSession, shellAppTarget, shellAppUpstreamHeaders } from "./session";

/** The shared server socket relay rechecks this authority before every delivery. */
export async function shellAppSocketPolicy(request: Request) {
  const app = await sessionAppForHost(request.headers.get("host") ?? "");
  const url = new URL(request.url);
  if (!app || request.headers.get("origin") !== app.origin || url.pathname.startsWith("/__mso_") ||
      url.pathname.startsWith("/_next")) return null;
  const session = await shellAppSession(request, app);
  if (!session?.device_id) return null;
  return { identity: session.device_id, target: shellAppTarget(app, url).toString(),
    headers: Object.fromEntries(shellAppUpstreamHeaders(request.headers, app)) };
}

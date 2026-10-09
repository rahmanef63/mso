import type { NextRequest } from "next/server";
import { sessionAppForHost, shellAppSession, shellAppTarget, shellAppUpstreamHeaders } from "./session";

/** The shared server socket relay rechecks this authority before every delivery. */
export async function shellAppSocketPolicy(request: NextRequest) {
  const app = await sessionAppForHost(request.headers.get("host") ?? "");
  if (!app || request.headers.get("origin") !== app.origin || request.nextUrl.pathname.startsWith("/__mso_") ||
      request.nextUrl.pathname.startsWith("/_next")) return null;
  const session = await shellAppSession(request, app);
  if (!session?.device_id) return null;
  return { identity: session.device_id, target: shellAppTarget(app, request.nextUrl).toString(),
    headers: Object.fromEntries(shellAppUpstreamHeaders(request.headers, app)) };
}

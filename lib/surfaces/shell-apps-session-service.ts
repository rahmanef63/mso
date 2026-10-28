import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { createShellAppCredential, sessionApps } from "@/lib/surfaces/session";
import { shellSessionHeaders } from "@/lib/surfaces/session-gate";
import { IS_DEMO } from "@/lib/demo";

export async function handleGetShellAppSession(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const headers = shellSessionHeaders(), { id } = await context.params;
  const app = !IS_DEMO && (await sessionApps()).find((entry) => entry.id === id);
  if (!app) return json({ error: "unavailable" }, { status: 404, headers });
  const session = await getSessionContext(), redirect = new URL(request.url).searchParams.get("redirect") === "1";
  if (!session || session.role !== "owner") {
    return json({ error: "unauthorized" }, { status: 401, headers });
  }
  const ticket = createShellAppCredential(app, session.session, process.env.OS_SESSION_SECRET ?? "", "ticket");
  if (!redirect) return json({ origin: app.origin, ticket }, { headers });
  const destination = new URL(app.startPath, app.origin);
  destination.hash = new URLSearchParams({ app_ticket: ticket }).toString();
  return new Response(null, { status: 302, headers: { ...headers, location: destination.href } });
}

import {
  a2aInboundConfig,
  a2aInboundOriginForRequest,
  inboundAgentCard,
} from "@/lib/a2a/inbound-config";
import { isA2ALoopbackUrl } from "@/lib/a2a/network";
import { resolveAgentSessionOwnerRef } from "@/lib/agent/session-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = a2aInboundConfig();
  const origin = a2aInboundOriginForRequest(req.url);
  if (!config.enabled || !origin)
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );

  const request = new URL(req.url);
  const local = Boolean(config.loopbackOrigin && isA2ALoopbackUrl(request));
  const sessionRef = request.searchParams.get("session")?.trim() || "";
  if (sessionRef && !local)
    return Response.json(
      { error: "not_found" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );

  let session = null;
  if (sessionRef) {
    try {
      session = await resolveAgentSessionOwnerRef(sessionRef);
    } catch {
      return Response.json(
        { error: "session_not_found" },
        { status: 404, headers: { "cache-control": "no-store" } },
      );
    }
  }

  return Response.json(inboundAgentCard({ origin, session, local }), {
    headers: {
      "content-type": "application/a2a+json; charset=utf-8",
      "cache-control": local ? "no-store" : "public, max-age=300",
    },
  });
}

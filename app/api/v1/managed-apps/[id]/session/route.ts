import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { managedAppOrigin } from "@/lib/managed-apps/origin";
import { createManagedAppTicket } from "@/lib/managed-apps/session";
import { getOrcaReadiness } from "@/lib/managed-apps/orca-readiness";
import { IS_DEMO } from "@/lib/demo";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (IS_DEMO || !session || !roleAtLeast(session.role, "operator")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await context.params;
  if (!isManagedAppId(id) || !managedAppOrigin(id)) return NextResponse.json({ error: "unavailable" }, { status: 404 });
  const origin = managedAppOrigin(id)!;
  const ticket = createManagedAppTicket(id, session.session, process.env.OS_SESSION_SECRET ?? "");

  if (id === "orca") {
    const readiness = await getOrcaReadiness();
    if (!readiness.available) {
      return NextResponse.json({ error: "unavailable", reason: readiness.reason }, { status: 503, headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({
      origin,
      ticket,
      pairingUrl: readiness.pairingUrl,
      webClientUrl: readiness.webClientUrl,
      runtimeId: readiness.runtimeId,
    }, { headers: { "cache-control": "no-store" } });
  }

  return NextResponse.json({ origin, ticket }, { headers: { "cache-control": "no-store" } });
}

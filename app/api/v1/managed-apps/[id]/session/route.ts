import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { isManagedAppId } from "@/lib/managed-apps/catalog";
import { managedAppOrigin } from "@/lib/managed-apps/origin";
import { createManagedAppTicket } from "@/lib/managed-apps/session";
import { getOrcaReadiness } from "@/lib/managed-apps/orca-readiness";
import { IS_DEMO } from "@/lib/demo";

export const dynamic = "force-dynamic";
const NO_STORE = { "cache-control": "no-store" } as const;
export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionContext();
  if (IS_DEMO || !session || !roleAtLeast(session.role, "operator")) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const { id } = await context.params;
  if (!isManagedAppId(id) || !managedAppOrigin(id)) return NextResponse.json({ error: "unavailable" }, { status: 404, headers: NO_STORE });
  const origin = managedAppOrigin(id)!;
  const ticket = createManagedAppTicket(id, session.session, process.env.OS_SESSION_SECRET ?? "");

  if (id === "orca") {
    const readiness = await getOrcaReadiness();
    if (!readiness.available) {
      return NextResponse.json({ error: "unavailable", reason: readiness.reason }, { status: 503, headers: NO_STORE });
    }
    return NextResponse.json({
      origin,
      ticket,
      pairingUrl: readiness.pairingUrl,
      webClientUrl: readiness.webClientUrl,
      runtimeId: readiness.runtimeId,
    }, { headers: NO_STORE });
  }

  return NextResponse.json({ origin, ticket }, { headers: NO_STORE });
}

import { NextResponse } from "next/server";
import { verifyAuth } from "@/lib/agent/server";
import { IS_DEMO } from "@/lib/demo";
import { runAppDeckPreflight } from "@/lib/managed-apps/appdeck-preflight";
import { getManagedAppDefinition, isManagedAppId } from "@/lib/managed-apps/catalog";
import { redact } from "@/lib/managed-apps/redact";

export async function handleGetManagedAppPreflight(req: Request, id: string): Promise<Response> {
  if (!(await verifyAuth(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isManagedAppId(id)) return NextResponse.json({ error: "unknown managed application" }, { status: 404 });
  if (IS_DEMO) {
    const def = getManagedAppDefinition(id);
    return NextResponse.json({
      appId: id,
      appName: def.name,
      installed: false,
      ready: false,
      summary: "Install and update actions are disabled in demo mode.",
      backend: def.installBackends[0] ?? null,
      checks: [
        {
          id: "demo",
          label: "Demo sandbox",
          status: "warn",
          detail: "Read-only demo mode does not modify services on the host.",
        },
      ],
      checkedAt: new Date().toISOString(),
    });
  }
  try {
    return NextResponse.json(await runAppDeckPreflight(id));
  } catch (error) {
    const reason = redact(error instanceof Error ? error.message : "preflight check failed");
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}

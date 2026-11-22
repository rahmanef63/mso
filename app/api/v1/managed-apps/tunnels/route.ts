import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import { IS_DEMO } from "@/lib/demo";
import { audit } from "@/lib/host/audit-api";
import { rateLimited } from "@/lib/host/limits-api";
import { readSetupJson } from "@/lib/infra/setup-http";
import { deleteSshTunnel, listSshTunnels, saveSshTunnel, startSshTunnel, stopSshTunnel } from "@/lib/managed-apps/ssh-tunnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

export async function GET() {
  const context = await getSessionContext();
  if (!context?.session.device_id) return json({ error: "unauthorized" }, { status: 401, headers });
  if (!roleAtLeast(context.role, "owner")) return json({ error: "owner_required" }, { status: 403, headers });
  return json(await listSshTunnels(), { headers });
}

export async function POST(request: Request) {
  const context = await getSessionContext();
  if (!context?.session.device_id) return json({ error: "unauthorized" }, { status: 401, headers });
  if (IS_DEMO || !roleAtLeast(context.role, "owner")) return json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`mapp-tunnels:${context.session.device_id}`, 20, 60_000)) {
    return json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    const body = await readSetupJson(request);
    const action = body.action;
    if (action === "save") {
      const tunnel = await saveSshTunnel({
        id: String(body.id ?? ""),
        appId: String(body.appId ?? ""),
        title: String(body.title ?? ""),
        sshUser: String(body.sshUser ?? ""),
        sshHost: String(body.sshHost ?? ""),
        sshPort: body.sshPort === undefined ? 22 : Number(body.sshPort),
        remotePort: Number(body.remotePort),
        localPort: Number(body.localPort),
        identityFile: typeof body.identityFile === "string" ? body.identityFile : undefined,
      });
      void audit({ action: "infra.write", actor: context.session.device_id, target: tunnel.id, ok: true, detail: "ssh-tunnel.save" });
      return json({ tunnel, snapshot: await listSshTunnels() }, { headers });
    }
    if (action === "start" && typeof body.id === "string") {
      const tunnel = await startSshTunnel(body.id);
      void audit({ action: "infra.write", actor: context.session.device_id, target: tunnel.id, ok: true, detail: "ssh-tunnel.start" });
      return json({ tunnel, snapshot: await listSshTunnels() }, { headers });
    }
    if (action === "stop" && typeof body.id === "string") {
      const tunnel = await stopSshTunnel(body.id);
      void audit({ action: "infra.write", actor: context.session.device_id, target: body.id, ok: true, detail: "ssh-tunnel.stop" });
      return json({ tunnel, snapshot: await listSshTunnels() }, { headers });
    }
    if (action === "delete" && typeof body.id === "string") {
      await deleteSshTunnel(body.id);
      void audit({ action: "infra.write", actor: context.session.device_id, target: body.id, ok: true, detail: "ssh-tunnel.delete" });
      return json({ snapshot: await listSshTunnels() }, { headers });
    }
    return json({ error: "invalid_tunnel_action" }, { status: 400, headers });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "tunnel_operation_failed" }, { status: 400, headers });
  }
}

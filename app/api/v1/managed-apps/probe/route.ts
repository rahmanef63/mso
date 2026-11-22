import { json } from "@/lib/api/route";
import { getSessionContext } from "@/lib/auth/require-session";
import { roleAtLeast } from "@/lib/auth/roles";
import type { RemoteProbeRequest } from "@/lib/contracts/remote-connect";
import { IS_DEMO } from "@/lib/demo";
import { rateLimited } from "@/lib/host/limits-api";
import { readSetupJson } from "@/lib/infra/setup-http";
import { runRemoteProbe } from "@/lib/managed-apps/remote-probe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store, private" };

function parseBody(raw: Record<string, unknown>): RemoteProbeRequest | null {
  if (raw.mode === "https-url" && typeof raw.url === "string") {
    return { mode: "https-url", url: raw.url };
  }
  if (raw.mode === "local-existing" && typeof raw.endpoint === "string") {
    return {
      mode: "local-existing",
      endpoint: raw.endpoint,
      ...(typeof raw.dataDir === "string" ? { dataDir: raw.dataDir } : {}),
    };
  }
  if (raw.mode === "ssh-tunnel" && typeof raw.sshUser === "string" && typeof raw.sshHost === "string") {
    return {
      mode: "ssh-tunnel",
      sshUser: raw.sshUser,
      sshHost: raw.sshHost,
      sshPort: raw.sshPort === undefined ? 22 : Number(raw.sshPort),
      remotePort: Number(raw.remotePort),
      ...(raw.localPort !== undefined ? { localPort: Number(raw.localPort) } : {}),
      ...(typeof raw.identityFile === "string" ? { identityFile: raw.identityFile } : {}),
      testSsh: raw.testSsh === true,
    };
  }
  return null;
}

export async function POST(request: Request) {
  const context = await getSessionContext();
  if (!context?.session.device_id) return json({ error: "unauthorized" }, { status: 401, headers });
  if (IS_DEMO || !roleAtLeast(context.role, "owner")) return json({ error: "owner_required" }, { status: 403, headers });
  if (rateLimited(`mapp-probe:${context.session.device_id}`, 20, 60_000)) {
    return json({ error: "rate_limited" }, { status: 429, headers });
  }
  try {
    const parsed = parseBody(await readSetupJson(request));
    if (!parsed) return json({ error: "invalid_probe_request" }, { status: 400, headers });
    const origin = new URL(request.url).origin;
    return json(await runRemoteProbe(parsed, origin), { headers });
  } catch {
    return json({ error: "probe_failed" }, { status: 400, headers });
  }
}

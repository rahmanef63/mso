import { NextRequest, NextResponse } from "next/server";
import {
  approveDevice,
  isApproved,
  isValidDeviceId,
  listDevices,
  revokeDevice,
  setDeviceRole,
} from "@/lib/auth/device-store";
import { getSessionContext } from "@/lib/auth/require-session";
import { DeviceRoleError, isDeviceRole } from "@/lib/auth/roles";
import { terminateCamoufoxSessions } from "@/lib/camoufox/service";
import { audit } from "@/lib/host/audit-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerContext() {
  const context = await getSessionContext();
  if (!context || context.role !== "owner") return null;
  return context;
}

export async function GET() {
  if (!(await ownerContext())) {
    return NextResponse.json({ error: "Owner role required" }, { status: 403 });
  }
  return NextResponse.json(await listDevices(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const context = await ownerContext();
  if (!context) return NextResponse.json({ error: "Owner role required" }, { status: 403 });

  let body: { action?: string; deviceId?: string; label?: string; role?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action, deviceId, label } = body;
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json({ error: "Missing or invalid device id" }, { status: 400 });
  }
  if ((action === "revoke" || action === "set_role") && deviceId === context.session.device_id) {
    return NextResponse.json(
      { error: "Use another owner device or the local CLI to change this device" },
      { status: 409 },
    );
  }

  try {
    if (action === "approve") {
      // Least privilege in the web UI: an omitted role creates a viewer. The local
      // bootstrap CLI preserves its historical owner default separately.
      const role = body.role === undefined ? "viewer" : body.role;
      if (!isDeviceRole(role)) return NextResponse.json({ error: "Invalid device role" }, { status: 400 });
      await approveDevice(deviceId, typeof label === "string" ? label : undefined, role);
      await audit({
        action: "auth.device",
        actor: context.session.device_id,
        target: deviceId,
        detail: `approved as ${role}`,
      });
    } else if (action === "set_role") {
      if (!isDeviceRole(body.role)) return NextResponse.json({ error: "Invalid device role" }, { status: 400 });
      await setDeviceRole(deviceId, body.role);
      if (body.role === "viewer") await terminateCamoufoxSessions().catch(() => {});
      await audit({
        action: "auth.device",
        actor: context.session.device_id,
        target: deviceId,
        detail: `role=${body.role}`,
      });
    } else if (action === "revoke") {
      const wasApproved = await isApproved(deviceId);
      // Revoke first: after this write, the target cannot start a new request or
      // reconnect. Then tear down the shared VNC unit to evict a live socket.
      await revokeDevice(deviceId);
      await audit({
        action: "auth.device",
        actor: context.session.device_id,
        target: deviceId,
        detail: "revoked",
      });
      if (wasApproved) {
        try {
          await terminateCamoufoxSessions();
        } catch {
          return NextResponse.json(
            { error: "device_revoked_browser_teardown_failed", revoked: true },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      }
    } else {
      return NextResponse.json({ error: "action must be approve, set_role, or revoke" }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof DeviceRoleError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json(
    { ok: true, ...(await listDevices()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

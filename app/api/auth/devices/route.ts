import { NextRequest, NextResponse } from "next/server";
import {
  approveDevice,
  isApproved,
  isValidDeviceId,
  listDevices,
  revokeDevice,
} from "@/lib/auth/device-store";
import { requireSession } from "@/lib/auth/require-session";
import { terminateCamoufoxSessions } from "@/lib/camoufox/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// In-app device management. Only an already-authenticated (trusted) session may
// list pending devices and approve/revoke them — so the owner can approve a new
// device from one that's already logged in, without the CLI.

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await listDevices());
}

export async function POST(req: NextRequest) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { action?: string; deviceId?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { action, deviceId, label } = body;
  if (!isValidDeviceId(deviceId)) {
    return NextResponse.json({ error: "Missing or invalid device id" }, { status: 400 });
  }
  if (action === "approve") {
    await approveDevice(deviceId, typeof label === "string" ? label : undefined);
  } else if (action === "revoke") {
    const wasApproved = await isApproved(deviceId);
    // Revoke first: after this write, the target device cannot start a new viewer
    // or reconnect. Then tear down the shared VNC unit to evict any live socket.
    await revokeDevice(deviceId);
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
    return NextResponse.json({ error: "action must be approve or revoke" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, ...(await listDevices()) });
}

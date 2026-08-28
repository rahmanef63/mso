import { cookies } from "next/headers";
import { verifySession, type SessionPayload } from "./session";
import { getApprovedDevice, type ApprovedDevice } from "./device-store";
import { roleAtLeast, type DeviceRole } from "./roles";
import { IS_DEMO } from "@/lib/demo";

export const SESSION_COOKIE = "session";

function secret(): string {
  return process.env.OS_SESSION_SECRET ?? "";
}

export type SessionContext = {
  session: SessionPayload;
  device: ApprovedDevice;
  role: DeviceRole;
};

// Reads + verifies every signed-session candidate, then resolves the device record
// live. Role changes and revocation therefore take effect on the next request; no
// authorization claim is cached in a cookie that can remain stale for 24 hours.
export async function getSessionContext(): Promise<SessionContext | null> {
  if (IS_DEMO) return null;
  const jar = await cookies();
  for (const { value } of jar.getAll(SESSION_COOKIE)) {
    const session = verifySession(value, secret());
    if (!session?.device_id) continue;
    const device = await getApprovedDevice(session.device_id);
    if (!device) continue;
    return { session, device, role: device.role };
  }
  return null;
}

/** Compatibility payload accessor for existing callers that do not need role data. */
export async function getSession(): Promise<SessionPayload | null> {
  return (await getSessionContext())?.session ?? null;
}

export async function requireSession(minimumRole: DeviceRole = "viewer"): Promise<boolean> {
  const context = await getSessionContext();
  return context !== null && roleAtLeast(context.role, minimumRole);
}

// Approved device id behind the current session, or null. Audit attribution remains
// stable across role changes; role is recorded separately by security-sensitive routes.
export async function getSessionActor(): Promise<string | null> {
  return (await getSessionContext())?.session.device_id ?? null;
}

import { deviceSessionValid } from "./live-session";
import { configuredSessionCookieScope } from "./session-cookie";
import { verifySession, type SessionPayload } from "./session";
import { currentSessionPolicy, getApprovedDevice, type ApprovedDevice } from "./device-store";
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

export type SessionCookieReader = () => Promise<Iterable<{ value: string }>> | Iterable<{ value: string }>;

/** Default cookie source for Next.js app router request contexts. */
export async function nextSessionCookieReader(): Promise<Iterable<{ value: string }>> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  return jar.getAll(SESSION_COOKIE);
}

// Reads + verifies every signed-session candidate, then resolves the device record
// live. Role changes and revocation therefore take effect on the next request; no
// authorization claim is cached in a cookie that can remain stale for 24 hours.
export async function getSessionContext(
  cookieReader: SessionCookieReader = nextSessionCookieReader,
): Promise<SessionContext | null> {
  if (IS_DEMO) return null;
  const candidates = await cookieReader();
  const policy = await currentSessionPolicy(configuredSessionCookieScope());
  for (const { value } of candidates) {
    const session = verifySession(value, secret());
    if (!session?.device_id || session.cookie_scope !== policy.scope || session.cookie_epoch !== policy.epoch) continue;
    const device = await getApprovedDevice(session.device_id);
    if (!deviceSessionValid(session, device)) continue;
    return { session, device, role: device.role };
  }
  return null;
}

/** Compatibility payload accessor for existing callers that do not need role data. */
export async function getSession(
  cookieReader: SessionCookieReader = nextSessionCookieReader,
): Promise<SessionPayload | null> {
  return (await getSessionContext(cookieReader))?.session ?? null;
}

export async function requireSession(
  minimumRole: DeviceRole = "viewer",
  cookieReader: SessionCookieReader = nextSessionCookieReader,
): Promise<boolean> {
  const context = await getSessionContext(cookieReader);
  return context !== null && roleAtLeast(context.role, minimumRole);
}

// Approved device id behind the current session, or null. Audit attribution remains
// stable across role changes; role is recorded separately by security-sensitive routes.
export async function getSessionActor(
  cookieReader: SessionCookieReader = nextSessionCookieReader,
): Promise<string | null> {
  return (await getSessionContext(cookieReader))?.session.device_id ?? null;
}

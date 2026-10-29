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

// `lib/` must not reach for a framework, so the Next cookie source is registered by the
// framework's own entry point (instrumentation.ts) instead of imported here. Anything that
// forgets to register gets a loud error rather than a silent unauthenticated request.
//
// The slot lives on `globalThis` on purpose. In a production build the bundler can inline
// this module into more than one chunk (instrumentation and the route graph are separate
// entries), which yields two module instances each with its own variable. A registration
// that landed in the instrumentation copy would then be invisible to every route, and the
// process would fail closed on every request with "not registered". One process-global slot
// is what makes the registration actually shared.
const READER_SLOT = Symbol.for("mso.sessionCookieReader");

type ReaderSlot = { [READER_SLOT]?: SessionCookieReader };

export function registerSessionCookieReader(reader: SessionCookieReader): void {
  (globalThis as ReaderSlot)[READER_SLOT] = reader;
}

function defaultCookieReader(): Promise<Iterable<{ value: string }>> | Iterable<{ value: string }> {
  const reader = (globalThis as ReaderSlot)[READER_SLOT];
  if (!reader) {
    throw new Error(
      "session cookie reader is not registered; call registerSessionCookieReader() from the app entry (instrumentation.ts)",
    );
  }
  return reader();
}

// Reads + verifies every signed-session candidate, then resolves the device record
// live. Role changes and revocation therefore take effect on the next request; no
// authorization claim is cached in a cookie that can remain stale for 24 hours.
export async function getSessionContext(
  cookieReader: SessionCookieReader = defaultCookieReader,
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
  cookieReader: SessionCookieReader = defaultCookieReader,
): Promise<SessionPayload | null> {
  return (await getSessionContext(cookieReader))?.session ?? null;
}

export async function requireSession(
  minimumRole: DeviceRole = "viewer",
  cookieReader: SessionCookieReader = defaultCookieReader,
): Promise<boolean> {
  const context = await getSessionContext(cookieReader);
  return context !== null && roleAtLeast(context.role, minimumRole);
}

// Approved device id behind the current session, or null. Audit attribution remains
// stable across role changes; role is recorded separately by security-sensitive routes.
export async function getSessionActor(
  cookieReader: SessionCookieReader = defaultCookieReader,
): Promise<string | null> {
  return (await getSessionContext(cookieReader))?.session.device_id ?? null;
}

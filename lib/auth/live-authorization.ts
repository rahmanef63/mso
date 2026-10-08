import { currentSessionPolicy, getApprovedDevice } from "./device-store";
import { configuredSessionCookieScope } from "./session-cookie";
import { deviceSessionValid } from "./live-session";
import { roleAtLeast, type DeviceRole } from "./roles";
import type { SessionPayload } from "./session";

export async function liveSessionAuthorized(session: SessionPayload, role: DeviceRole): Promise<boolean> {
  if (!session.device_id) return false;
  const [device, policy] = await Promise.all([getApprovedDevice(session.device_id), currentSessionPolicy(configuredSessionCookieScope())]);
  return deviceSessionValid(session, device) && roleAtLeast(device.role, role) &&
    session.cookie_scope === policy.scope && session.cookie_epoch === policy.epoch;
}

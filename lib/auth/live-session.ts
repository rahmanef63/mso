import type { ApprovedDevice } from "./device-store";
import type { SessionPayload } from "./session";

/** Durable logout and reapproval boundaries apply to every derived session. */
export function deviceSessionValid(session: SessionPayload, device: ApprovedDevice | null): device is ApprovedDevice {
  return !!device && Number.isFinite(session.issued_at) && Number.isFinite(session.expires_at) &&
    session.expires_at > Date.now() && session.issued_at >= device.approvedAt &&
    (device.sessionsRevokedAt === undefined || session.issued_at > device.sessionsRevokedAt);
}

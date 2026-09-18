import { MIN_SECRET_LEN, signSession, verifySession, type SessionPayload } from "@/lib/auth/session";

export const CAMOUFOX_VIEWER_COOKIE = "__Host-mso-camoufox";
export const CAMOUFOX_VIEWER_TICKET_TTL_MS = 60_000;
export const CAMOUFOX_VIEWER_COOKIE_TTL_MS = 2 * 60 * 60 * 1000;

const ticketSecret = (secret: string) => "camoufox-viewer-ticket:" + secret;
const cookieSecret = (secret: string) => "camoufox-viewer-cookie:" + secret;

function payload(deviceId: string, now: number, ttlMs: number): SessionPayload {
  return {
    issued_at: now,
    expires_at: now + ttlMs,
    device_id: deviceId,
    cookie_scope: "camoufox-viewer",
    cookie_epoch: "camoufox-viewer-v1",
  };
}

export function createCamoufoxViewerTicket(deviceId: string, secret: string, now = Date.now()): string {
  if (secret.length < MIN_SECRET_LEN) throw new Error("viewer signing secret is not configured");
  return signSession(payload(deviceId, now, CAMOUFOX_VIEWER_TICKET_TTL_MS), ticketSecret(secret));
}

export function verifyCamoufoxViewerTicket(token: string, secret: string): SessionPayload | null {
  if (secret.length < MIN_SECRET_LEN) return null;
  return verifySession(token, ticketSecret(secret));
}

export function createCamoufoxViewerCookie(deviceId: string, secret: string, now = Date.now()): string {
  if (secret.length < MIN_SECRET_LEN) throw new Error("viewer signing secret is not configured");
  return signSession(payload(deviceId, now, CAMOUFOX_VIEWER_COOKIE_TTL_MS), cookieSecret(secret));
}

export function verifyCamoufoxViewerCookie(token: string, secret: string): SessionPayload | null {
  if (secret.length < MIN_SECRET_LEN) return null;
  return verifySession(token, cookieSecret(secret));
}

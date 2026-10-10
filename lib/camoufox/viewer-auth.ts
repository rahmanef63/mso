import { MIN_SECRET_LEN, signSession, verifySession, type SessionPayload } from "@/lib/auth/session";

export const CAMOUFOX_VIEWER_COOKIE = "__Host-mso-camoufox";
export const CAMOUFOX_VIEWER_TICKET_TTL_MS = 60_000;
export const CAMOUFOX_VIEWER_COOKIE_TTL_MS = 2 * 60 * 60 * 1000;

const ticketSecret = (secret: string) => "camoufox-viewer-ticket:" + secret;
const cookieSecret = (secret: string) => "camoufox-viewer-cookie:" + secret;
type ViewerParent = Pick<SessionPayload,"device_id"|"issued_at"|"expires_at"> & {parent_expires_at?:number};
type ViewerSession = SessionPayload & {parent_expires_at:number};

function payload(parent: ViewerParent, now: number, ttlMs: number): ViewerSession {
  const parentExpiry = parent.parent_expires_at ?? parent.expires_at;
  if (!Number.isFinite(parentExpiry)) throw new Error("viewer parent expiry is required");
  return {
    issued_at: parent.issued_at,
    expires_at: Math.min(parentExpiry,now + ttlMs),
    parent_expires_at:parentExpiry,
    device_id: parent.device_id,
    cookie_scope: "camoufox-viewer",
    cookie_epoch: "camoufox-viewer-v1",
  };
}

export function createCamoufoxViewerTicket(parent: ViewerParent, secret: string, now = Date.now()): string {
  if (secret.length < MIN_SECRET_LEN) throw new Error("viewer signing secret is not configured");
  return signSession(payload(parent,now,CAMOUFOX_VIEWER_TICKET_TTL_MS),ticketSecret(secret));
}

function verifyViewerSession(token:string,secret:string): ViewerSession|null {
  const session = verifySession(token,secret) as ViewerSession|null;
  return session && Number.isFinite(session.parent_expires_at) && session.parent_expires_at >= session.expires_at ? session:null;
}
export function verifyCamoufoxViewerTicket(token: string, secret: string): ViewerSession | null {
  if (secret.length < MIN_SECRET_LEN) return null;
  return verifyViewerSession(token, ticketSecret(secret));
}

export function createCamoufoxViewerCookie(parent: ViewerParent, secret: string, now = Date.now()): string {
  if (secret.length < MIN_SECRET_LEN) throw new Error("viewer signing secret is not configured");
  return signSession(payload(parent,now,CAMOUFOX_VIEWER_COOKIE_TTL_MS),cookieSecret(secret));
}

export function verifyCamoufoxViewerCookie(token: string, secret: string): ViewerSession | null {
  if (secret.length < MIN_SECRET_LEN) return null;
  return verifyViewerSession(token, cookieSecret(secret));
}

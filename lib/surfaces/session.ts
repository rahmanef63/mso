import { MIN_SECRET_LEN, signSession, verifySession, type SessionPayload } from "@/lib/auth/session";
import { liveSessionAuthorized } from "@/lib/auth/live-authorization";
import type { SurfaceApp } from "@/lib/contracts/surface-app";
import { configuredSurfaceApps } from "./config";
import { externalSurfaceSharesSession } from "./cookie-policy";

export const SHELL_APP_COOKIE = "__Host-mso-shell-app";
export const SHELL_APP_TICKET_TTL = 60_000;
export const SHELL_APP_COOKIE_TTL = 2 * 60 * 60 * 1000;
type App = Pick<SurfaceApp, "id" | "origin">;
type Kind = "ticket" | "cookie";
type Credential = SessionPayload & { parent_expires_at: number };
function key(app: App, kind: Kind, secret: string) {
  if (secret.length < MIN_SECRET_LEN) throw new Error("application signing secret is unavailable");
  return `shell-app:${app.id}:${app.origin}:${kind}:${secret}`;
}
export function createShellAppCredential(app: App, session: SessionPayload, secret: string, kind: Kind, now = Date.now()) {
  const ttl = kind === "ticket" ? SHELL_APP_TICKET_TTL : SHELL_APP_COOKIE_TTL;
  const parentExpiry = (session as Partial<Credential>).parent_expires_at ?? session.expires_at;
  const payload = { ...session, parent_expires_at: parentExpiry, expires_at: Math.min(parentExpiry, now + ttl) };
  return signSession(payload, key(app, kind, secret));
}
export function verifyShellAppCredential(app: App, token: string, secret: string, kind: Kind) {
  if (token.length > 4096) return null;
  try {
    const session = verifySession(token, key(app, kind, secret)) as Credential | null;
    return session && Number.isFinite(session.parent_expires_at) && session.parent_expires_at >= session.expires_at ? session : null;
  } catch { return null; }
}
export async function sessionApps() {
  const cockpit = process.env.OS_PUBLIC_ORIGIN;
  if (!cockpit) return [];
  let origin: URL;
  try { origin = new URL(cockpit); } catch { return []; }
  if (origin.protocol !== "https:") return [];
  const apps = (await configuredSurfaceApps()).filter(app => app.sessionUpstream && app.origin !== origin.origin &&
    !externalSurfaceSharesSession(app.origin, [origin.origin]) &&
    new URL(app.sessionUpstream!).port !== (process.env.PORT ?? "4005"));
  // Ambiguous hostname ownership fails closed for every duplicate, never first-match wins.
  return apps.filter(app => apps.filter(other => new URL(other.origin).host === new URL(app.origin).host).length === 1);
}
export async function sessionAppForHost(host: string) {
  return (await sessionApps()).find(app => new URL(app.origin).host === host.toLowerCase());
}
export async function shellAppSession(request: Request, app: App): Promise<SessionPayload | null> {
  const secret = process.env.OS_SESSION_SECRET ?? "";
  for (const candidate of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...parts] = candidate.trim().split("=");
    if (name !== SHELL_APP_COOKIE) continue;
    const session = verifyShellAppCredential(app, parts.join("="), secret, "cookie");
    if (session && await liveSessionAuthorized(session, "owner")) return session;
  }
  return null;
}
export function shellAppUpstreamHeaders(incoming: Headers, app: SurfaceApp) {
  const headers = new Headers(incoming), target = new URL(app.sessionUpstream!);
  for (const name of ["cookie", "authorization", "referer", "x-os-managed-app-host", "x-forwarded-host"]) headers.delete(name);
  headers.set("host", target.host);
  headers.set("origin", target.origin);
  return headers;
}
export function shellAppTarget(app: SurfaceApp, url: URL) {
  const target = new URL(app.sessionUpstream!);
  target.pathname = url.pathname; target.search = url.search;
  return target;
}

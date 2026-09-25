import { createHash, randomBytes } from "node:crypto";
import { currentSessionPolicy, getApprovedDevice } from "@/lib/auth/device-store";
import { configuredSessionCookieScope } from "@/lib/auth/session-cookie";
import { mutateIntegrationState } from "./connection-storage";
import { assertNotBusy, IntegrationError, type ConnectionSelector } from "./identity";
import { googleTarget, googleApp } from "./google-native-state";
import { GOOGLE_SCOPES, googleRedirectUri, isGoogleProvider } from "./google-native-config";
import { acquireGoogleLease, pinGoogle, releaseGoogleLease } from "./google-native-lease";
import { exchangeGoogleCode } from "./google-oauth-http";
import type { GoogleActor, GoogleProvider } from "./google-native-types";
export const GOOGLE_FLOW_TTL = 10 * 60_000;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const googleFlowCookie = (state: string) => "__Host-mso-google-" + hash(state).slice(0, 16);
const invalid = () => new IntegrationError("google_authorization_expired_or_invalid", 401);
export async function assertGoogleActor(actor: GoogleActor) {
  if (!actor.deviceId || actor.sessionExpiresAt <= Date.now() || actor.cookieScope !== configuredSessionCookieScope()) throw invalid();
  const policy = await currentSessionPolicy(actor.cookieScope), device = await getApprovedDevice(actor.deviceId);
  if (policy.epoch !== actor.cookieEpoch || device?.role !== "owner") throw invalid();
}
export async function beginGoogleAuthorization(provider: GoogleProvider, selection: ConnectionSelector, actor: GoogleActor) {
  await assertGoogleActor(actor);
  const redirectUri = googleRedirectUri(), state = randomBytes(32).toString("base64url"), binding = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  const result = await mutateIntegrationState(d => {
    const { user, c } = googleTarget(d, provider, selection), app = googleApp(d, user, c.values.appConnection);
    assertNotBusy(c); assertNotBusy(app);
    c.googlePending = { stateHash: hash(state), bindingHash: hash(binding), verifier, expiresAt: Date.now() + GOOGLE_FLOW_TTL,
      redirectUri, connectionUid: c.uid, connectionRevision: c.revision, appConnection: app.id, appUid: app.uid, appRevision: app.revision, actor };
    return { clientId: app.values.clientId, email: c.googleOAuth?.email };
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  const params = { client_id: result.clientId, redirect_uri: redirectUri, response_type: "code", access_type: "offline", prompt: "consent select_account", scope: `openid email ${GOOGLE_SCOPES[provider]}`,
    state, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (result.email) url.searchParams.set("login_hint", result.email);
  // Returned only to the authenticated native browser start route, never an MCP tool response.
  return { authorizationUrl: url.href, cookieName: googleFlowCookie(state), binding, expiresIn: GOOGLE_FLOW_TTL / 1000 };
}
export async function completeGoogleAuthorization(state: string, binding: string, code?: string, denied = false) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(binding) || (!denied && (typeof code !== "string" || !code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)))) throw invalid();
  const claimed = await mutateIntegrationState(d => {
    for (const [user, owner] of Object.entries(d.users)) for (const [provider, rows] of Object.entries(owner.connections)) {
      if (!isGoogleProvider(provider)) continue;
      for (const c of Object.values(rows)) {
        const p = c.googlePending;
        if (!p || p.stateHash !== hash(state)) continue;
        if (p.bindingHash !== hash(binding) || p.expiresAt <= Date.now() || p.redirectUri !== googleRedirectUri() || p.connectionUid !== c.uid || p.connectionRevision !== c.revision) throw invalid();
        const app = googleApp(d, user, c.values.appConnection);
        if (app.id !== p.appConnection || app.uid !== p.appUid || app.revision !== p.appRevision) throw invalid();
        const lease = acquireGoogleLease(d, provider, { user, connection: c.id });
        delete c.googlePending; // Consume once, before contacting Google; failure needs a fresh authorization.
        return { lease, pending: p };
      }
    }
    throw invalid();
  });
  const { lease, pending } = claimed;
  try {
    await assertGoogleActor(pending.actor);
    if (denied) throw new IntegrationError("google_consent_denied", 403);
    const tokens = await exchangeGoogleCode(lease.app.values, lease.provider, code!, pending.verifier);
    if (lease.c.googleOAuth?.subject && lease.c.googleOAuth.subject !== tokens.subject) throw new IntegrationError("google_account_changed_disconnect_first", 409);
    await assertGoogleActor(pending.actor);
    await mutateIntegrationState(d => {
      const { c, app } = pinGoogle(d, lease);
      if (pending.expiresAt <= Date.now() || pending.redirectUri !== googleRedirectUri()) throw invalid();
      c.googleOAuth = { ...tokens, appConnection: app.id, appUid: app.uid, appRevision: app.revision, redirectUri: pending.redirectUri, state: "connected", updatedAt: Date.now() };
      c.revision++; c.updatedAt = Date.now(); delete c.lastCheck; delete c.verifiedAt;
    });
    return { user: lease.user, provider: lease.provider, connection: lease.connection, status: "authorized", verificationRequired: true };
  } finally { await releaseGoogleLease(lease); }
}

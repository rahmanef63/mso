import { GOOGLE_APP_PROVIDER, GOOGLE_SCOPES, isGoogleProvider, normalizeGoogleConfig, googleRedirectUri } from "./google-native-config";
import { IntegrationError, selectConnection, type ConnectionSelector, type IntegrationConnection, type IntegrationState } from "./identity";
import type { GoogleProvider } from "./google-native-types";

export function googleTarget(state: IntegrationState, provider: GoogleProvider, selector: ConnectionSelector) {
  const selected = selectConnection(state, provider, selector), c = selected.connection;
  if (c.source !== "direct" || c.authMethod !== "oauth2" || c.sharedFrom) throw new IntegrationError("google_native_connection_required", 409);
  return { user: selected.user, c };
}
export function googleApp(state: IntegrationState, user: string, id: string | undefined) {
  if (!id) throw new IntegrationError("google_app_required", 409);
  const app = state.users[user]?.connections[GOOGLE_APP_PROVIDER]?.[id];
  if (!app || app.source !== "direct" || app.authMethod !== "oauth-app" || app.sharedFrom) throw new IntegrationError("google_app_required", 409);
  const values = normalizeGoogleConfig(GOOGLE_APP_PROVIDER, app.values);
  if (!values.clientId || !values.clientSecret) throw new IntegrationError("google_app_setup_required", 409);
  return app;
}
export function assertGoogleGrantApp(c: IntegrationConnection, app: IntegrationConnection) {
  const grant = c.googleOAuth;
  if (!grant || grant.appConnection !== app.id || grant.appUid !== app.uid || grant.appRevision !== app.revision || grant.state !== "connected") throw new IntegrationError("google_reauthorization_required", 401);
  if (!isGoogleProvider(c.provider) || !grant.scopes.includes(GOOGLE_SCOPES[c.provider])) throw new IntegrationError("google_required_scope_missing", 403);
  return grant;
}
export function googleConnectionMetadata(state: IntegrationState, user: string, c: IntegrationConnection) {
  if (c.provider === GOOGLE_APP_PROVIDER) return { state: c.values.clientId && c.values.clientSecret ? "app-configured" : "incomplete", configurationOnly: true };
  if (!isGoogleProvider(c.provider)) return {};
  let app: IntegrationConnection;
  try { app = googleApp(state, user, c.values.appConnection); } catch { return { state: "app-required", google: { appConnection: c.values.appConnection || null } }; }
  const grant = c.googleOAuth;
  let redirectUri: string | null = null; try { redirectUri = googleRedirectUri(); } catch {}
  const active = !!grant && grant.appUid === app.uid && grant.appRevision === app.revision && grant.appConnection === app.id && grant.state === "connected" && grant.redirectUri === redirectUri;
  const requiredScope = GOOGLE_SCOPES[c.provider];
  const pending = c.googlePending && c.googlePending.expiresAt > Date.now() && c.googlePending.connectionUid === c.uid && c.googlePending.connectionRevision === c.revision && c.googlePending.appUid === app.uid && c.googlePending.appRevision === app.revision;
  const check = c.lastCheck?.revision === c.revision ? c.lastCheck.result : undefined;
  return { state: pending ? "authorization-pending" : !grant ? "authorization-required" : !active ? "reauthorization-required" : !grant.scopes.includes(requiredScope) ? "scope-missing" : check === "verified" ? "verified" : check === "invalid" ? "invalid" : check === "unavailable" ? "unavailable" : "authorized",
    google: { appConnection: app.id, requiredScope, account: grant ? { email: grant.email } : null,
      grantedScopes: grant?.scopes ?? [], accessExpiresAt: grant?.expiresAt ?? null, refreshAvailable: !!grant?.refreshToken,
      connectionOnly: true, note: "OAuth consent is not verification of a specific property. Verify actual API access." } };
}
export function clearGoogleRuntime(c: IntegrationConnection) { delete c.googleOAuth; delete c.googlePending; }
export function validateGoogleRuntime(c: IntegrationConnection) {
  if (!c.googleOAuth && !c.googlePending) return;
  const fail = () => { throw new IntegrationError("invalid_google_runtime_store"); };
  if (!isGoogleProvider(c.provider) || c.source !== "direct" || c.authMethod !== "oauth2" || c.sharedFrom) fail();
  const g = c.googleOAuth;
  if (g) {
    if (!g.redirectUri || !g.appConnection || !g.appUid || !Number.isSafeInteger(g.appRevision) || !g.subject || !g.email || !Array.isArray(g.scopes) || g.scopes.length > 30 || g.scopes.some(v => typeof v !== "string" || v.length > 256) || !Number.isFinite(g.expiresAt) || !Number.isFinite(g.updatedAt) || !["connected", "reauthorization-required"].includes(g.state)) fail();
    for (const token of [g.accessToken, g.refreshToken]) if (typeof token !== "string" || token.length > 16384 || /[\s\x00-\x1f\x7f]/.test(token)) fail();
  }
  const p = c.googlePending;
  if (p && (!/^[a-f0-9]{64}$/.test(p.stateHash) || !/^[a-f0-9]{64}$/.test(p.bindingHash) || !/^[A-Za-z0-9_-]{43,128}$/.test(p.verifier) || !Number.isFinite(p.expiresAt) || !Number.isSafeInteger(p.connectionRevision) || !Number.isSafeInteger(p.appRevision) || !p.redirectUri || !p.connectionUid || !p.appUid || !p.appConnection || !p.actor?.deviceId || typeof p.actor.cookieEpoch !== "string" || !p.actor.cookieScope || !Number.isFinite(p.actor.sessionExpiresAt))) fail();
}

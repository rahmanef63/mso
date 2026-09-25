import { mutateIntegrationState, readIntegrationState } from "./connection-storage";
import { GOOGLE_APP_PROVIDER, isGoogleProvider, googleRedirectUri } from "./google-native-config";
import { googleTarget, googleApp, assertGoogleGrantApp, clearGoogleRuntime, googleConnectionMetadata } from "./google-native-state";
import { acquireGoogleLease, pinGoogle, releaseGoogleLease } from "./google-native-lease";
import { IntegrationError, assertNotBusy, identity, type ConnectionSelector } from "./identity";
import { refreshGoogleTokens } from "./google-oauth-http";
import { executeGoogleRead, GOOGLE_READ_OPERATIONS } from "./google-api";
import type { GoogleProvider } from "./google-native-types";

export async function bindGoogleApp(provider: GoogleProvider, selection: ConnectionSelector, appConnection: unknown) {
  return mutateIntegrationState(d => {
    const { c, user } = googleTarget(d, provider, selection), app = googleApp(d, user, identity(appConnection, "app_connection"));
    assertNotBusy(c); assertNotBusy(app);
    if (c.values.appConnection !== app.id) {
      if (c.googleOAuth) throw new IntegrationError("google_disconnect_before_app_change", 409);
      c.values = { appConnection: app.id }; clearGoogleRuntime(c); c.revision++; c.updatedAt = Date.now(); delete c.lastCheck; delete c.verifiedAt;
    }
    return { user, provider, connection: c.id, ...googleConnectionMetadata(d, user, c) };
  });
}
export async function disconnectGoogle(provider: GoogleProvider, selection: ConnectionSelector) {
  return mutateIntegrationState(d => {
    const { c, user } = googleTarget(d, provider, selection); assertNotBusy(c); clearGoogleRuntime(c); c.revision++; c.updatedAt = Date.now(); delete c.verifiedAt; delete c.lastCheck;
    return { user, provider, connection: c.id, disconnectedLocally: true, providerRevoked: false, detail: "MSO authorization removed. To revoke the Google app itself, review Google Account third-party connections." };
  });
}
export async function runNativeGoogle(provider: GoogleProvider, selection: ConnectionSelector, operation: string, args: Record<string, unknown>, verify = false) {
  const lease = await mutateIntegrationState(d => {
    const { c, user } = googleTarget(d, provider, selection), app = googleApp(d, user, c.values.appConnection);
    const grant = assertGoogleGrantApp(c, app); if (grant.redirectUri !== googleRedirectUri()) throw new IntegrationError("google_reauthorization_required", 401);
    if (c.googlePending && c.googlePending.expiresAt > Date.now()) throw new IntegrationError("google_authorization_pending", 409);
    return acquireGoogleLease(d, provider, selection);
  });
  try {
    let grant = lease.c.googleOAuth!;
    if (grant.expiresAt <= Date.now() + 60_000) {
      const refreshed = await refreshGoogleTokens(lease.app.values, provider, grant.refreshToken, grant.scopes);
      grant = { ...grant, ...refreshed, updatedAt: Date.now() };
      await mutateIntegrationState(d => { pinGoogle(d, lease).c.googleOAuth = grant; });
    }
    const result = await executeGoogleRead(provider, grant.accessToken, operation, args);
    await mutateIntegrationState(d => {
      const { c } = pinGoogle(d, lease);
      if (verify) { c.lastCheck = { revision: c.revision, checkedAt: Date.now(), result: "verified" }; c.verifiedAt = Date.now(); }
    });
    return { user: lease.user, provider, connection: lease.connection, source: "direct", authMethod: "oauth2", readOnly: true, result };
  } catch (error) {
    if (error instanceof IntegrationError && ["google_reauthorization_required", "google_required_scope_missing"].includes(error.code)) await mutateIntegrationState(d => {
      const { c } = pinGoogle(d, lease);
      if (c.googleOAuth) c.googleOAuth = { ...c.googleOAuth, accessToken: "", refreshToken: "", state: "reauthorization-required", updatedAt: Date.now() };
      delete c.verifiedAt; c.lastCheck = { revision: c.revision, checkedAt: Date.now(), result: "invalid" };
    });
    else if (verify) await mutateIntegrationState(d => {
      const { c } = pinGoogle(d, lease);
      delete c.verifiedAt;
      c.lastCheck = { revision: c.revision, checkedAt: Date.now(), result: error instanceof IntegrationError && error.status === 403 ? "invalid" : "unavailable" };
    });
    throw error;
  } finally { await releaseGoogleLease(lease); }
}
export async function verifyNativeGoogle(provider: GoogleProvider, selection: ConnectionSelector) {
  try {
    const operation = provider === "google-search-console" ? "google.searchConsole.sites.list" : "google.analytics.accountSummaries.list";
    await runNativeGoogle(provider, selection, operation, {}, true);
    return { id: provider, ok: true, detail: "Native Google read-only API access verified. Select an exact returned property before reporting." };
  } catch (error) { return { id: provider, ok: false, detail: error instanceof IntegrationError ? error.code : "google_verification_unavailable" }; }
}
export async function nativeGoogleStatus(provider: GoogleProvider | typeof GOOGLE_APP_PROVIDER, selection: ConnectionSelector) {
  if (provider === GOOGLE_APP_PROVIDER) {
    const d = await readIntegrationState();
    try { googleApp(d, identity(selection.user, "user"), identity(selection.connection, "connection")); return { id: provider, ok: null, detail: "App configuration stored; validate by completing Google consent, not an app-only probe." }; }
    catch { return { id: provider, ok: null, detail: "google_app_setup_required" }; }
  }
  if (!isGoogleProvider(provider)) throw new IntegrationError("unknown_google_provider");
  return verifyNativeGoogle(provider, selection);
}
export function googleOperations(provider: string) { return GOOGLE_READ_OPERATIONS.filter(row => row.provider === provider); }

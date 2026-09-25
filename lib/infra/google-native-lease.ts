import { randomUUID } from "node:crypto";
import { mutateIntegrationState } from "./connection-storage";
import { assertNotBusy, IntegrationError, type ConnectionSelector, type IntegrationConnection, type IntegrationState } from "./identity";
import { googleTarget, googleApp } from "./google-native-state";
import type { GoogleProvider } from "./google-native-types";
export type GoogleLease = { user: string; provider: GoogleProvider; connection: string; c: IntegrationConnection; app: IntegrationConnection; id: string };
export function pinGoogle(state: IntegrationState, lease: GoogleLease) {
  const { c } = googleTarget(state, lease.provider, { user: lease.user, connection: lease.connection });
  const app = googleApp(state, lease.user, c.values.appConnection);
  if (c.uid !== lease.c.uid || c.revision !== lease.c.revision || app.uid !== lease.app.uid || app.revision !== lease.app.revision || c.lease?.id !== lease.id || app.lease?.id !== lease.id || c.lease.until <= Date.now() || app.lease.until <= Date.now()) throw new IntegrationError("google_connection_changed", 409);
  return { c, app };
}
export function acquireGoogleLease(state: IntegrationState, provider: GoogleProvider, selector: ConnectionSelector): GoogleLease {
  const { user, c } = googleTarget(state, provider, selector), app = googleApp(state, user, c.values.appConnection);
  assertNotBusy(c); assertNotBusy(app);
  const lease = { id: randomUUID(), until: Date.now() + 120000 };
  c.lease = lease; app.lease = lease;
  return { user, provider, connection: c.id, c: structuredClone(c), app: structuredClone(app), id: lease.id };
}
export async function releaseGoogleLease(lease: GoogleLease) {
  await mutateIntegrationState(state => {
    const rows = state.users[lease.user]?.connections;
    for (const c of [rows?.[lease.provider]?.[lease.connection], rows?.["google-oauth-app"]?.[lease.app.id]]) if (c?.lease?.id === lease.id) delete c.lease;
  });
}

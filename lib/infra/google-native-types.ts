/** Server-only OAuth grants live in the existing owner integration store, never a transfer DTO. */
export type GoogleProvider = "google-search-console" | "google-analytics";
export type GoogleActor = { deviceId: string; cookieScope: string; cookieEpoch: string; sessionExpiresAt: number };
export type GoogleGrant = {
  appConnection: string; appUid: string; appRevision: number; redirectUri: string;
  subject: string; email: string; scopes: string[];
  accessToken: string; refreshToken: string; expiresAt: number;
  state: "connected" | "reauthorization-required"; updatedAt: number;
};
export type GooglePending = {
  stateHash: string; bindingHash: string; verifier: string; expiresAt: number;
  connectionUid: string; connectionRevision: number;
  appConnection: string; appUid: string; appRevision: number; redirectUri: string;
  actor: GoogleActor;
};

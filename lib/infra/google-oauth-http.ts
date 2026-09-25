import { IntegrationError } from "./identity";
import { GOOGLE_SCOPES, googleRedirectUri } from "./google-native-config";
import type { GoogleProvider } from "./google-native-types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const MAX_BYTES = 64 * 1024;
async function googleJson(url: typeof TOKEN_URL | typeof USERINFO_URL, init: RequestInit): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new IntegrationError("google_oauth_response_too_large", 502);
    const reader = response.body?.getReader(); if (!reader) throw new IntegrationError("google_oauth_invalid_response", 502);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > MAX_BYTES) throw new IntegrationError("google_oauth_response_too_large", 502); chunks.push(part.value); } }
    finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    let data: unknown; try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new IntegrationError("google_oauth_invalid_response", 502); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new IntegrationError("google_oauth_invalid_response", 502);
    const row = data as Record<string, unknown>;
    if (!response.ok) throw new IntegrationError(row.error === "invalid_grant" ? "google_reauthorization_required" : response.status === 429 ? "google_oauth_rate_limited" : "google_oauth_request_failed", response.status === 429 ? 429 : 502);
    return row;
  } catch (error) { throw error instanceof IntegrationError ? error : new IntegrationError("google_oauth_unavailable", 502); }
}
function token(value: unknown): value is string { return typeof value === "string" && value.length > 10 && value.length <= 16_384 && !/[\s\x00-\x1f\x7f]/.test(value); }
export function googleTokenResult(data: Record<string, unknown>, provider: GoogleProvider, previousRefresh?: string) {
  const scopes = typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(GOOGLE_SCOPES[provider])) throw new IntegrationError("google_required_scope_missing", 403);
  if (!token(data.access_token) || String(data.token_type).toLowerCase() !== "bearer" || !Number.isFinite(data.expires_in) || Number(data.expires_in) < 30 || Number(data.expires_in) > 86400) throw new IntegrationError("google_oauth_invalid_tokens", 502);
  const refresh = data.refresh_token ?? previousRefresh;
  if (!token(refresh)) throw new IntegrationError("google_offline_access_required", 409);
  return { accessToken: data.access_token, refreshToken: refresh, expiresAt: Date.now() + Number(data.expires_in) * 1000, scopes };
}
export async function exchangeGoogleCode(app: Record<string, string>, provider: GoogleProvider, code: string, verifier: string) {
  const data = await googleJson(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: googleRedirectUri(), grant_type: "authorization_code", code, code_verifier: verifier }) });
  const tokens = googleTokenResult(data, provider);
  const info = await googleJson(USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" } });
  if (typeof info.sub !== "string" || !/^[A-Za-z0-9_-]{1,255}$/.test(info.sub) || typeof info.email !== "string" || info.email.length > 320 || !/^[^\s<>@]+@[^\s<>@]+$/.test(info.email) || info.email_verified !== true) throw new IntegrationError("google_identity_unverified", 403);
  return { ...tokens, subject: info.sub, email: info.email };
}
export async function refreshGoogleTokens(app: Record<string, string>, provider: GoogleProvider, refreshToken: string, grantedScopes: string[]) {
  const data = await googleJson(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }) });
  // RFC 6749 permits omitted scope when unchanged. The pinned previous grant is the fallback.
  return googleTokenResult({ ...data, scope: data.scope ?? grantedScopes.join(" ") }, provider, refreshToken);
}

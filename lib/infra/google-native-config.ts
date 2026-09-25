import type { InfraProviderDefinition } from "./types";
import { IntegrationError, identity } from "./identity";
import type { GoogleProvider } from "./google-native-types";

export const GOOGLE_APP_PROVIDER = "google-oauth-app";
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";
export const GOOGLE_SCOPES: Record<GoogleProvider, string> = {
  "google-search-console": "https://www.googleapis.com/auth/webmasters.readonly",
  "google-analytics": "https://www.googleapis.com/auth/analytics.readonly",
};
export const isGoogleProvider = (id: string): id is GoogleProvider => Object.hasOwn(GOOGLE_SCOPES, id);
export function googlePublicOrigin(): string {
  try {
    const url = new URL(process.env.OS_PUBLIC_ORIGIN || "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch { throw new IntegrationError("google_public_https_origin_required", 409); }
}
export const googleRedirectUri = () => googlePublicOrigin() + GOOGLE_CALLBACK_PATH;
export const GOOGLE_PROVIDERS: InfraProviderDefinition[] = [
  { id: "google-oauth-app", title: "Google OAuth app", feature: false,
    description: "Configure this installation’s Google OAuth client once, then authorize separate Search Console and Analytics accounts. No Composio required.",
    fields: [
      { key: "clientId", label: "Google OAuth client ID", secret: false, required: true, description: "Web application client ID from your Google Cloud project." },
      { key: "clientSecret", label: "Google OAuth client secret", secret: true, required: true, description: "Enter only in this private form. App configuration is not user consent." },
    ] },
  ...(["google-search-console", "google-analytics"] as const).map(id => ({ id, feature: false,
    title: id === "google-search-console" ? "Google Search Console" : "Google Analytics 4",
    description: "Native read-only Google OAuth. Select a Google OAuth app, authorize the intended account, then verify actual API access. An API key alone cannot read private reports.",
    fields: [{ key: "appConnection", label: "Google OAuth app connection", secret: false, required: true, description: "An existing Google OAuth app under the same credential owner. Select it in the connection manager." }],
  })),
];
export function normalizeGoogleConfig(provider: string, raw: Record<string, unknown>): Record<string, string> {
  if (isGoogleProvider(provider)) return raw.appConnection ? { appConnection: identity(raw.appConnection, "app_connection") } : {};
  const out: Record<string, string> = {};
  if (raw.clientId) {
    if (typeof raw.clientId !== "string" || !/^[A-Za-z0-9._-]{8,220}\.apps\.googleusercontent\.com$/.test(raw.clientId.trim())) throw new IntegrationError("invalid_google_client_id");
    out.clientId = raw.clientId.trim();
  }
  if (raw.clientSecret) {
    if (typeof raw.clientSecret !== "string" || !/^[A-Za-z0-9_-]{12,256}$/.test(raw.clientSecret.trim())) throw new IntegrationError("invalid_google_client_secret");
    out.clientSecret = raw.clientSecret.trim();
  }
  return out;
}
export function googleGuidance(provider: string) {
  return {
    url: "https://console.cloud.google.com/auth/clients",
    reference: "https://developers.google.com/identity/protocols/oauth2/web-server",
    steps: provider === GOOGLE_APP_PROVIDER ? [
      "Create or select your own Google Cloud project. Enable Search Console API and/or Analytics Admin + Analytics Data APIs as needed.",
      "Configure the consent screen and create a Web application OAuth client. Configure this MSO installation’s public HTTPS origin first.",
      "Register the exact callback shown in the native Google connection panel. Never use a Composio callback.",
      "Enter the client ID and secret here. This saves app configuration only; each named Google account still needs its own consent and API verification.",
      "Testing-mode users, Workspace policies and Google app verification can limit authorization. MSO does not bypass these requirements.",
    ] : [
      "Create a Google OAuth app connection under the same credential owner, or reuse an existing one.",
      "Select that app in this connection’s Native Google setup. Open Google consent in a top-level browser, not an embedded webview.",
      "Authorize the intended account for this service’s read-only scope, then verify actual property access.",
      "No API key, measurement ID, browser cookie or Composio project key substitutes for Google user consent.",
    ],
  };
}

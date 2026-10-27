import { GOOGLE_APP_PROVIDER, isGoogleProvider, googleGuidance } from "./google-native-config";
import { ADDITIONAL_GUIDANCE, type AdditionalProviderId } from "./additional-providers";
import { getInfraProviderDefinition, resolveProviderId } from "./catalog";
import type { InfraProviderId, InfraProviderRef } from "./types";

export const SETUP_METHOD_IDS = ["direct", "project", "organization", "personal", "deployment", "admin", "mail", "payment", "mcp", "oauth-app", "oauth2"] as const;
export type SetupMethod = typeof SETUP_METHOD_IDS[number];
/** One Convex product, two credential shapes; every pre-collapse method id survives. */
const CONVEX_FIELD_KEYS: Record<string, string[] | null> = {
  personal: ["personalToken"],
  deployment: ["deployKey", "deploymentName"],
  admin: ["apiUrl", "adminKey"],
  direct: null, // pre-collapse self-hosted rows keep their declared requirements
};
function convexFields(provider: InfraProviderId, method: SetupMethod) {
  if (!(method in CONVEX_FIELD_KEYS)) throw new Error("Choose a Convex personal token, deployment key or self-hosted admin key");
  const keys = CONVEX_FIELD_KEYS[method];
  // Method fields stay CREDENTIAL fields only. `deploymentKind` is a non-secret
  // routing fact on the provider definition; it is not asked for per method and is
  // inferred from the shape the operator actually supplies.
  return getInfraProviderDefinition(provider).fields
    .filter(f => keys === null || keys.includes(f.key))
    .map(f => ({ ...f, required: keys === null ? f.required : true }));
}
export function setupFields(provider: InfraProviderRef, method: SetupMethod) {
  const canonical = resolveProviderId(provider);
  if (!canonical) throw new Error("Unsupported authentication method");
  return fieldsFor(canonical, method);
}
function fieldsFor(provider: InfraProviderId, method: SetupMethod) {
  if (provider === GOOGLE_APP_PROVIDER || isGoogleProvider(provider)) {
    if (method !== (provider === GOOGLE_APP_PROVIDER ? "oauth-app" : "oauth2")) throw new Error("Unsupported Google authentication method");
    return getInfraProviderDefinition(provider).fields;
  }
  if (provider === "hostinger") {
    if (!["direct", "mail"].includes(method)) throw new Error("Choose Hostinger account or scoped Mail API token");
    const keys = method === "mail" ? ["mailApiToken", "mailOrderId"] : ["apiToken"];
    return getInfraProviderDefinition(provider).fields.filter(f => keys.includes(f.key)).map(f => ({ ...f, required: true }));
  }
  if (provider === "doku") {
    if (!["payment", "mcp"].includes(method)) throw new Error("Choose DOKU Payment REST or DOKU MCP credentials");
    const keys = method === "payment" ? ["paymentClientId", "paymentSecretKey", "paymentEnvironment"] : ["mcpClientId", "mcpApiKey", "environment"];
    return getInfraProviderDefinition(provider).fields.filter(f => keys.includes(f.key)).map(f => ({ ...f, required: true }));
  }
  if (provider === "convex") return convexFields(provider, method);
  if (provider === "composio") {
    if (!["project", "organization"].includes(method)) throw new Error("Choose a Composio project/user or organization key");
    return getInfraProviderDefinition(provider).fields.filter(f => f.key === (method === "project" ? "apiKey" : "orgApiKey")).map(f => ({ ...f, required: true }));
  }
  if (method !== "direct") throw new Error("Unsupported authentication method");
  return getInfraProviderDefinition(provider).fields;
}
export function setupMethod(provider: InfraProviderRef, method?: string): SetupMethod {
  const canonical = resolveProviderId(provider) ?? throwUnsupported();
  const value = method ?? (canonical === GOOGLE_APP_PROVIDER ? "oauth-app" : isGoogleProvider(canonical) ? "oauth2" : canonical === "composio" ? "project" : canonical === "convex" ? "personal" : canonical === "doku" ? "mcp" : "direct");
  if (!(SETUP_METHOD_IDS as readonly string[]).includes(value)) throw new Error("Unsupported authentication method");
  fieldsFor(canonical, value as SetupMethod);
  return value as SetupMethod;
}
const throwUnsupported = (): never => { throw new Error("Unsupported authentication method"); };
export function setupMethods(provider: InfraProviderRef): Array<{id: SetupMethod; label: string}> {
  const canonical = resolveProviderId(provider) ?? throwUnsupported();
  const id = canonical;
  if (id === GOOGLE_APP_PROVIDER) return [{ id: "oauth-app", label: "Google OAuth app (configuration only)" }];
  if (isGoogleProvider(id)) return [{ id: "oauth2", label: "Native Google OAuth · read-only" }];
  if (id === "hostinger") return [{ id: "direct", label: "Account API token" }, { id: "mail", label: "Scoped Mail API token" }];
  if (id === "composio") return [{ id: "project", label: "Project API key" }, { id: "organization", label: "Organization API key" }];
  if (id === "convex") return [{ id: "personal", label: "Convex Cloud · personal access token" }, { id: "deployment", label: "Convex Cloud · deployment key" }, { id: "admin", label: "Self-hosted · deployment URL + admin key" }];
  if (id === "doku") return [{id:"payment",label:"Payment REST · Client ID + Secret Key"},{id:"mcp",label:"MCP · Client ID + API Key"}];
  return [{ id: "direct", label: "Direct credential" }];
}
export function setupGuidance(provider: InfraProviderRef, method: SetupMethod) {
  const canonical = resolveProviderId(provider) ?? throwUnsupported();
  const id = canonical;
  if (id === GOOGLE_APP_PROVIDER || isGoogleProvider(id)) return googleGuidance(id);
  if(id==="doku")return method==="payment"?{url:"https://dashboard.doku.com/bo/developer/api-keys",reference:"https://developers.doku.com/get-started-with-doku-api/signature-component/non-snap/signature-component-from-request-header",steps:["Open DOKU Back Office → Developer → API Keys.","Use Client ID + Secret Key for the signed Non-SNAP payment API; the API Key is not a substitute for the HMAC Secret Key.","Choose sandbox first unless this project is explicitly approved for live payments.","Enter credentials only in this private setup form. MSO verifies them with a signed read-only status lookup before saving."]}:{url:"https://developers.doku.com/accept-payments/doku-mcp-server",reference:"https://developers.doku.com/accept-payments/doku-mcp-server",steps:["Open DOKU's official MCP Server guide and choose Sandbox first unless this project is explicitly approved for production payments.","Use the DOKU MCP Client ID + MCP API Key; do not substitute the Payment REST Secret Key.","Enter them only in this private setup form; do not paste them into chat, Baton notes, RR, Git, or project MCP JSON.","MSO calls the fixed official DOKU MCP endpoint with a read-only MCP initialize request before saving the connection."]};
  if (id in ADDITIONAL_GUIDANCE) return ADDITIONAL_GUIDANCE[id as AdditionalProviderId];
  const guides = {
    composio: {
      url: "https://platform.composio.dev",
      reference: "https://docs.composio.dev/reference/authenticating-to-composio",
      steps: method === "organization"
        ? ["Open Composio Settings.", "Choose General Settings → Organization Access Tokens.", "Create a token only when cross-project administration is required.", "Copy the organization token into this form. It uses x-org-api-key, not x-api-key."]
        : ["Select the intended Composio project.", "Open Settings → Project Settings → API Keys.", "Create a project API key with the least privileges needed. A user key (uak_…) from `composio login` is also accepted and is sent as x-user-api-key automatically.", "Copy the project key into this form. Connected-account OAuth tokens remain in Composio."],
    },
    cloudflare: {
      url: "https://dash.cloudflare.com/profile/api-tokens",
      reference: "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/",
      steps: ["Open My Profile → API Tokens.", "Choose Create Token, then scope it to the intended zones only.", "Use Zone Read for inventory and DNS Edit only when DNS writes are needed.", "Copy the token. Zone ID and Account ID are optional pins, not secrets."],
    },
    hostinger: {
      url: "https://hpanel.hostinger.com/",
      reference: "https://developers.hostinger.com/",
      steps: method === "mail" ? ["Use the Hostinger Mail API token created for the intended mail order.", "Keep its scope limited to only the mailboxes this connection should manage.", "Copy the token and its mail order ID into this named connection.", "MSO validates it by listing one mailbox from that exact order."] : ["Sign in to the intended Hostinger account.", "Open Dev Tools → API in the hPanel sidebar.", "Create a named account token with a limited expiry.", "This token can manage VPS/DNS and, when the account has mail service, Hostinger Mail API orders."],
    },
    dokploy: {
      url: "https://docs.dokploy.com/docs/core/api",
      reference: "https://docs.dokploy.com/docs/core/api",
      steps: ["Open your own Dokploy panel, not a third-party panel.", "Open the account settings and create an API key.", "Enter the panel API URL. Use HTTPS, or loopback for a panel on this VPS.", "Copy the key into this form. MSO checks the project-list endpoint before saving."],
    },
  };
  return guides[provider as keyof typeof guides];
}

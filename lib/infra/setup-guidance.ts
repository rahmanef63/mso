import { ADDITIONAL_GUIDANCE, type AdditionalProviderId } from "./additional-providers";
import { getInfraProviderDefinition } from "./catalog";
import type { InfraProviderId } from "./types";

export type SetupMethod = "direct" | "project" | "organization" | "personal" | "deployment" | "mail";
export function setupFields(provider: InfraProviderId, method: SetupMethod) {
  if (provider === "hostinger") {
    if (!["direct", "mail"].includes(method)) throw new Error("Choose Hostinger account or scoped Mail API token");
    const keys = method === "mail" ? ["mailApiToken", "mailOrderId"] : ["apiToken"];
    return getInfraProviderDefinition(provider).fields.filter(f => keys.includes(f.key)).map(f => ({ ...f, required: true }));
  }
  if (provider === "convex-cloud") {
    if (!["personal", "deployment"].includes(method)) throw new Error("Choose a Convex personal token or deployment key");
    const keys = method === "personal" ? ["personalToken"] : ["deployKey", "deploymentName"];
    return getInfraProviderDefinition(provider).fields.filter(f => keys.includes(f.key)).map(f => ({ ...f, required: true }));
  }
  if (provider === "composio") {
    if (!["project", "organization"].includes(method)) throw new Error("Choose a Composio project or organization key");
    return getInfraProviderDefinition(provider).fields.filter(f => f.key === (method === "project" ? "apiKey" : "orgApiKey")).map(f => ({ ...f, required: true }));
  }
  if (method !== "direct") throw new Error("Unsupported authentication method");
  return getInfraProviderDefinition(provider).fields;
}
export function setupMethod(provider: InfraProviderId, method?: string): SetupMethod {
  const value = method ?? (provider === "composio" ? "project" : provider === "convex-cloud" ? "personal" : "direct");
  if (!["direct", "project", "organization", "personal", "deployment", "mail"].includes(value)) throw new Error("Unsupported authentication method");
  setupFields(provider, value as SetupMethod);
  return value as SetupMethod;
}
export function setupMethods(provider: InfraProviderId): Array<{id: SetupMethod; label: string}> {
  if (provider === "hostinger") return [{ id: "direct", label: "Account API token" }, { id: "mail", label: "Scoped Mail API token" }];
  if (provider === "composio") return [{ id: "project", label: "Project API key" }, { id: "organization", label: "Organization API key" }];
  if (provider === "convex-cloud") return [{ id: "personal", label: "Personal access token" }, { id: "deployment", label: "Deployment key" }];
  return [{ id: "direct", label: "Direct credential" }];
}
export function setupGuidance(provider: InfraProviderId, method: SetupMethod) {
  if (provider in ADDITIONAL_GUIDANCE) return ADDITIONAL_GUIDANCE[provider as AdditionalProviderId];
  const guides = {
    composio: {
      url: "https://platform.composio.dev",
      reference: "https://docs.composio.dev/reference/authenticating-to-composio",
      steps: method === "organization"
        ? ["Open Composio Settings.", "Choose General Settings → Organization Access Tokens.", "Create a token only when cross-project administration is required.", "Copy the organization token into this form. It uses x-org-api-key, not x-api-key."]
        : ["Select the intended Composio project.", "Open Settings → Project Settings → API Keys.", "Create a project API key with the least privileges needed.", "Copy the project key into this form. Connected-account OAuth tokens remain in Composio."],
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

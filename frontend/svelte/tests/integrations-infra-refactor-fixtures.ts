// Fixtures for integrations-infra-refactor.test.ts. Kept beside the test so
// the test file stays inside the repository's 220-line physical line ratchet.
import type { IntegrationConnectionSummary } from "../src/lib/integrations/integrations-api.ts";
import type { IntegrationCatalogProvider } from "../src/lib/integrations/integrations-workspace-api.ts";

export const providers: IntegrationCatalogProvider[] = [
  {
    id: "convex", title: "Convex", description: "One Convex provider.",
    sources: [{ id: "direct", label: "MSO direct", methods: [] }],
  },
  {
    id: "telegram", title: "Telegram", description: "Bot API.",
    sources: [{ id: "direct", label: "MSO direct", methods: [] }],
  },
];

export const connections: IntegrationConnectionSummary[] = [
  {
    user: "default", id: "prod", label: "Prod", provider: "convex", source: "direct",
    authMethod: "team", scope: "account", isDefault: true, missing: [], state: "verified",
    verifiedAt: 1, lastCheckResult: null, lastCheckDetail: null,
  },
  {
    user: "default", id: "bot", label: "Bot", provider: "telegram", source: "direct",
    authMethod: "direct", scope: "account", isDefault: false, missing: ["botToken"], state: "incomplete",
    verifiedAt: null, lastCheckResult: null, lastCheckDetail: null,
  },
  {
    user: "default", id: "prod-alias", label: "Prod alias", provider: "convex-cloud", source: "direct",
    authMethod: "deployment", scope: "deployment", isDefault: false, missing: [], state: "configured",
    verifiedAt: null, lastCheckResult: null, lastCheckDetail: null,
  },
];

export const setupRequest = { provider: "convex-cloud", method: "team", user: "default", connection: "prod" };

export const setupGrantPayload = (token: string) => ({
  token,
  setup: {
    provider: "convex-cloud", title: "Convex", method: "team", label: "Prod", user: "default",
    connection: "prod", source: "direct", authMethod: "team", scope: "account", expiresAt: 1,
    store: "owner-only", fields: [{ key: "teamToken", label: "Team token", secret: true, required: true, description: "x", stored: true }],
    guidance: { steps: ["Open Convex team settings."] },
  },
});

export const transferTreePayload = {
  users: [{
    id: "default", label: "Default",
    providers: [{
      id: "convex-cloud", title: "Convex",
      connections: [{ id: "prod", label: "Prod", source: "direct", storedFields: 2 }],
    }],
  }],
};

export const exportBundlePayload = {
  bundle: {
    mode: "metadata", producer: { name: "mso" },
    users: [{
      id: "default", label: "Default",
      connections: [{ id: "prod", provider: "convex", values: { teamToken: "super-secret" } }],
    }],
  },
};

export const importPlanPayload = {
  planId: "plan-1", canApply: true, connections: [{ id: "a" }], createUsers: [{ id: "b" }],
  warnings: [{ reason: "external_authorization_required" }], requiresWarningAcceptance: true,
};

export const channelDraftBase = {
  name: "Ops", provider: "telegram" as const, credential: "default::bot",
  defaultTarget: "", workflowId: "", agentGroupId: "", enabled: true,
};

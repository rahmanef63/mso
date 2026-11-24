// Shared fixtures for integrations-infra-refactor.test.ts. Kept out of the test file so
// the suite stays under the repository's 500-line file ratchet.

export const SIGNAL = () => new AbortController().signal;

export const jsonOf = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

export const SETUP_TOKEN = "a".repeat(43);

export const catalogPayload = {
  catalog: [
    {
      id: "convex", title: "Convex", description: "One Convex provider, both deployment kinds.",
      sources: [{
        id: "direct", label: "MSO direct",
        methods: [{
          id: "team", label: "Convex Cloud team token", scope: "account",
          fields: [{ key: "teamToken", label: "Team access token", secret: true, required: true, description: "team scope" }],
        }],
      }],
    },
    {
      id: "convex-cloud", title: "Convex Cloud", description: "Retired read alias.",
      sources: [{
        id: "direct", label: "MSO direct",
        methods: [{ id: "deployment", label: "Deployment key", scope: "deployment", fields: [] }],
      }],
    },
    {
      id: "composio", title: "Composio", description: "Connect a project key.",
      sources: [{
        id: "direct", label: "MSO direct",
        methods: [{ id: "project", label: "Project API key", scope: "project", fields: [] }],
      }],
    },
  ],
};

export const channelsPayload = {
  version: 1, revision: 7,
  providers: [{ id: "telegram", title: "Telegram", inbound: "webhook", sendText: true, inboundEvents: true }],
  credentials: [{
    user: "default", userLabel: "Default", id: "bot", label: "Main bot", provider: "telegram", state: "verified",
  }],
  channels: [{
    id: "ch-1", name: "Ops", provider: "telegram", credential: { user: "default", connection: "bot" },
    enabled: true, defaultTarget: "-100123", workflowId: "wf-1", agentGroupId: null,
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    lastCheck: { at: "2026-01-02T00:00:00.000Z", ok: true, detail: "Bot ready" },
    connection: { state: "verified" },
  }],
};

export const infraPayload = {
  providers: [
    {
      id: "convex-cloud", label: "Convex Cloud", configured: true, deploymentKind: "self-hosted",
      values: { apiUrl: "https://convex.example.com" },
      fields: [{ key: "apiUrl" }, { key: "adminKey" }], missing: [],
      secret: "never-expose-this",
    },
    { id: "convex", label: "Convex", configured: false, fields: ["teamToken"], missing: ["teamToken"] },
    { id: "dokploy", label: "Dokploy", configured: true, fields: ["apiUrl"], missing: [] },
    { id: "cloudflare", label: "Cloudflare", configured: true, fields: ["apiToken"], missing: [] },
  ],
};

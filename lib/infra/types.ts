export const INFRA_PROVIDER_IDS = ["dokploy", "cloudflare", "hostinger", "composio", "github", "vercel", "convex", "resend", "stripe", "clerk", "supabase", "telegram", "discord", "doku", "linear", "mcp", "openai-app", "google-oauth-app", "google-search-console", "google-analytics"] as const;
export type InfraProviderId = (typeof INFRA_PROVIDER_IDS)[number];

/**
 * One Convex product, two credential shapes. `deploymentKind` is NON-SECRET and
 * records which shape a connection uses; a legacy row without it is inferred from
 * `apiUrl` at read time (see `convexDeploymentKind` in ./catalog).
 */
export const CONVEX_DEPLOYMENT_KINDS = ["cloud", "self-hosted"] as const;
export type ConvexDeploymentKind = (typeof CONVEX_DEPLOYMENT_KINDS)[number];

/** Legacy provider id. READ ALIAS ONLY — never a member of INFRA_PROVIDER_IDS. */
export const CONVEX_LEGACY_PROVIDER_ID = "convex-cloud";
/**
 * Any id a caller may still hold: the current set, plus the retired `convex-cloud`
 * read alias. Entry points that store or summarize credentials accept this and
 * canonicalize internally, so an old CLI invocation or stored row resolves.
 */
export type InfraProviderRef = InfraProviderId | typeof CONVEX_LEGACY_PROVIDER_ID;

export const CONVEX_OPERATION_IDS = [
  "convex.customDomains.list",
  "convex.customDomain.ensure",
  "convex.canonical.get",
  "convex.canonical.set",
  "convex.env.presence",
  "convex.project.deploy",
  "convex.snapshot.import",
] as const;
export type ConvexOperationId = (typeof CONVEX_OPERATION_IDS)[number];
export type ConvexOperationAvailability = "supported" | "unsupported";
export type ConvexOperationSupport = {
  operation: ConvexOperationId;
  cloud: ConvexOperationAvailability;
  selfHosted: ConvexOperationAvailability;
  /** Present exactly when the operation is refused for a kind, so a UI can grey it out. */
  reason?: string;
};

/**
 * Machine-readable per-kind capability map. `lib/infra/connection-dispatch.ts`
 * refuses with `convex_operation_unsupported_for_kind` instead of a silent 404,
 * and the provider UI can disable the greyed-out rows from this same table.
 *
 * Every operation is unsupported for `self-hosted` today for ONE structural
 * reason: MSO's runner reaches a deployment by minting an ephemeral deploy key
 * through the Convex Cloud management API (api.convex.dev), and a self-hosted
 * deployment exposes no such key-minting endpoint. Registering them as
 * "supported" would only replace today's 404 with a mid-run failure.
 */
export const CONVEX_OPERATION_SUPPORT: readonly ConvexOperationSupport[] = [
  {
    operation: "convex.customDomains.list",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Custom domains are registered through the Convex Cloud management API; a self-hosted deployment serves its own reverse proxy.",
  },
  {
    operation: "convex.customDomain.ensure",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Custom domains are registered through the Convex Cloud management API; a self-hosted deployment serves its own reverse proxy.",
  },
  {
    operation: "convex.canonical.get",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Canonical URL registration is a Convex Cloud feature; a self-hosted deployment is addressed by its own origin.",
  },
  {
    operation: "convex.canonical.set",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Canonical URL registration is a Convex Cloud feature; a self-hosted deployment is addressed by its own origin.",
  },
  {
    operation: "convex.env.presence",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Reads environment names with an ephemeral deploy key minted by the Convex Cloud management API; no self-hosted equivalent is wired yet.",
  },
  {
    operation: "convex.project.deploy",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Deploys with an ephemeral deploy key minted by the Convex Cloud management API; self-hosted deploys need the deployment URL + admin key passed to the CLI instead.",
  },
  {
    operation: "convex.snapshot.import",
    cloud: "supported",
    selfHosted: "unsupported",
    reason: "Imports with an ephemeral deploy key minted by the Convex Cloud management API; self-hosted imports need the deployment URL + admin key passed to the CLI instead.",
  },
];

export type InfraProviderValues = Record<string, string>;
export type LegacyInfraStore = { providers?: Partial<Record<InfraProviderId, InfraProviderValues>> };
export type InfraField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  description: string;
  links?: readonly { label: string; url: string }[];
};
export type InfraProviderDefinition = {
  id: InfraProviderId; title: string; description: string; feature: boolean; fields: InfraField[];
};
export type InfraProviderSummary = {
  id: InfraProviderId; title: string; description: string; feature: boolean;
  configured: boolean; missing: string[]; values: Record<string, string>; fields: InfraField[];
};
export type InfraDoctorResult = { id: InfraProviderId; ok: boolean | null; detail: string };
export type { IntegrationState as InfraStore, ConnectionSelector, IntegrationConnection, IntegrationUser } from "./identity";

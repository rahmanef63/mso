export const INFRA_PROVIDER_IDS = ["dokploy", "cloudflare", "hostinger", "composio", "github", "vercel", "convex-cloud", "convex", "resend", "stripe", "clerk", "supabase"] as const;
export type InfraProviderId = (typeof INFRA_PROVIDER_IDS)[number];

export type InfraProviderValues = Record<string, string>;
export type InfraStore = {
  providers?: Partial<Record<InfraProviderId, InfraProviderValues>>;
};

export type InfraField = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  description: string;
};

export type InfraProviderDefinition = {
  id: InfraProviderId;
  title: string;
  description: string;
  feature: boolean;
  fields: InfraField[];
};

export type InfraProviderSummary = {
  id: InfraProviderId;
  title: string;
  description: string;
  feature: boolean;
  configured: boolean;
  missing: string[];
  values: Record<string, string>;
  fields: InfraField[];
};

export type InfraDoctorResult = {
  id: InfraProviderId;
  ok: boolean | null;
  detail: string;
};

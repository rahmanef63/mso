import { withIntegrationSelection } from "@/lib/infra/connection-service";
import { selectionFrom } from "@/lib/infra/connection-dispatch";
import { INTEGRATION_SELECTOR_SCHEMA } from "./tools-integrations";
import { doctorInfraProvider, ensureDokployProject, INFRA_PROVIDER_IDS, isInfraProviderId, listCloudflareZones, listDokployApplications, listDokployProjects, readInfraProvider, summarizeInfraProvider, upsertCloudflareDns, upsertDokployPublicBuildEnv, upsertHostingerDns } from "@/lib/infra";
import { type McpTool, S, str } from "./tool-kit";

const dnsSchema = {
  name: { type: "string", description: "Fully-qualified DNS hostname, e.g. app.example.com" },
  type: { type: "string", enum: ["A", "AAAA", "CNAME", "TXT"], description: "DNS record type" },
  content: { type: "string", description: "DNS record value/target" },
  ttl: { type: "number", description: "Optional TTL seconds. Cloudflare defaults to automatic." },
};

const BASE_INFRA_TOOLS: McpTool[] = [
  {
    name: "infra_providers_list",
    description: "List native MSO integrations and infrastructure providers, showing masked configuration state and missing required fields. Raw credentials are never returned.",
    scope: "read",
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: S({}),
    run: async () => Promise.all(INFRA_PROVIDER_IDS.map(async (id) => summarizeInfraProvider(id, await readInfraProvider(id)))),
  },
  {
    name: "infra_provider_doctor",
    description: "Live-check one configured infrastructure provider against its real API. Use infra_providers_list first. Tokens are read from MSO private state and never passed in tool arguments.",
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: S({ id: { type: "string", enum: [...INFRA_PROVIDER_IDS] } }, ["id"]),
    run: async (a) => {
      const id = str(a, "id");
      if (!isInfraProviderId(id)) throw new Error(`unknown infrastructure provider: ${id}`);
      return doctorInfraProvider(id);
    },
  },
  {
    name: "dokploy_projects_list",
    description: "List projects from the configured Dokploy API. Credentials stay in the private provider store.",
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: S({}),
    run: async () => listDokployProjects(),
  },
  {
    name: "dokploy_applications_list",
    description: "List Dokploy applications inside one exact project without returning environment values or provider credentials.",
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: S({ projectId: { type: "string", description: "Exact Dokploy project id from dokploy_projects_list" } }, ["projectId"]),
    run: async (a) => listDokployApplications(str(a, "projectId")),
  },
  {
    name: "dokploy_application_public_env_upsert",
    description: "Idempotently set one public browser build environment variable (NEXT_PUBLIC_/VITE_/PUBLIC_/REACT_APP_/EXPO_PUBLIC_) on one Dokploy application, verify it privately, and queue a redeploy only when the value changed. Secret/server-only variables are refused.",
    scope: "write",
    annotations: { idempotentHint: true, openWorldHint: true },
    audit: { action: "infra.write", targetArg: "applicationId" },
    limit: { key: "infra.dokploy", max: 20, windowMs: 60_000 },
    inputSchema: S({ applicationId: { type: "string", description: "Exact Dokploy application id" }, key: { type: "string", description: "Public browser build environment variable name" }, value: { type: "string", description: "Non-secret public build value" } }, ["applicationId", "key", "value"]),
    run: async (a) => upsertDokployPublicBuildEnv({ applicationId: str(a, "applicationId"), key: str(a, "key"), value: str(a, "value") }),
  },
  {
    name: "dokploy_project_ensure",
    description: "Idempotently ensure a Dokploy project exists by exact name. Creates it only when absent.",
    scope: "write",
    annotations: { idempotentHint: true, openWorldHint: true },
    audit: { action: "infra.write", targetArg: "name" },
    limit: { key: "infra.dokploy", max: 20, windowMs: 60_000 },
    inputSchema: S({ name: { type: "string", description: "Dokploy project name" } }, ["name"]),
    run: async (a) => ensureDokployProject(str(a, "name")),
  },
  {
    name: "cloudflare_zones_list",
    description: "List zones accessible to the configured Cloudflare token. Read-only and paginated with a hard cap.",
    scope: "read",
    annotations: { readOnlyHint: true, openWorldHint: true },
    inputSchema: S({}),
    run: async () => listCloudflareZones(),
  },
  {
    name: "cloudflare_dns_upsert",
    description: "Create or PATCH exactly one Cloudflare DNS record. Never performs bulk zone writes, never uses PUT, refuses ambiguous or conflicting record sets, and defaults Cloudflare proxying off unless proxied=true is explicit.",
    scope: "write",
    annotations: { idempotentHint: true, openWorldHint: true },
    audit: { action: "infra.write", targetArg: "name" },
    limit: { key: "infra.cloudflare", max: 20, windowMs: 60_000 },
    inputSchema: S({ ...dnsSchema, proxied: { type: "boolean", description: "Explicit opt-in to Cloudflare proxy for A/AAAA/CNAME. Defaults false." } }, ["name", "type", "content"]),
    run: async (a) => upsertCloudflareDns({ name: str(a, "name"), type: str(a, "type"), content: str(a, "content"), proxied: a.proxied === true, ttl: typeof a.ttl === "number" ? a.ttl : undefined }),
  },
  {
    name: "hostinger_dns_upsert",
    description: "Idempotently replace one exact Hostinger DNS name/type RR-set. The provider request contains only that RR-set, so unrelated zone records are never part of the mutation payload; ambiguity/conflicts are refused.",
    scope: "write",
    annotations: { idempotentHint: true, openWorldHint: true, destructiveHint: true },
    audit: { action: "infra.write", targetArg: "name" },
    limit: { key: "infra.hostinger", max: 10, windowMs: 60_000 },
    inputSchema: S({ name: dnsSchema.name, type: { type: "string", enum: ["A", "CNAME", "TXT"] }, content: dnsSchema.content, ttl: dnsSchema.ttl }, ["name", "type", "content"]),
    run: async (a) => upsertHostingerDns({ name: str(a, "name"), type: str(a, "type"), content: str(a, "content"), ttl: typeof a.ttl === "number" ? a.ttl : undefined }),
  },
];

export const INFRA_TOOLS:McpTool[]=BASE_INFRA_TOOLS.map(tool=>({...tool,
  inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,...INTEGRATION_SELECTOR_SCHEMA}},
  run:async(a,context)=>withIntegrationSelection(selectionFrom(a),()=>tool.run(a,context)),
}));

import { doctorInfraProvider, ensureDokployProject, INFRA_PROVIDER_IDS, isInfraProviderId, listCloudflareZones, listDokployProjects, readInfraProvider, summarizeInfraProvider, upsertCloudflareDns, upsertHostingerDns } from "@/lib/infra";
import { type McpTool, S, str } from "./tool-kit";

const dnsSchema = {
  name: { type: "string", description: "Fully-qualified DNS hostname, e.g. app.example.com" },
  type: { type: "string", enum: ["A", "AAAA", "CNAME", "TXT"], description: "DNS record type" },
  content: { type: "string", description: "DNS record value/target" },
  ttl: { type: "number", description: "Optional TTL seconds. Cloudflare defaults to automatic." },
};

export const INFRA_TOOLS: McpTool[] = [
  {
    name: "infra_providers_list",
    description: "List MSO infrastructure providers (Dokploy, Cloudflare, Hostinger, Composio), showing masked configuration state and missing required fields. Raw credentials are never returned.",
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

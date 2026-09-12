import type { AutomationFlow } from "@/lib/contracts/automation";
const ref = (name: string) => ({ $ref: "input." + name });
export const BUILTIN_FLOWS: AutomationFlow[] = ["cloudflare", "hostinger"].map(provider => ({
  id: provider + ".dns.ensure",
  description: "Verify one exact " + provider + " account, then create/update one DNS record. Existing unrelated records are preserved; propagation is separate.",
  inputs: {
    user: { type: "string", required: true, description: "Credential owner from integration_query." },
    connection: { type: "string", required: true, description: "Exact named direct provider connection." },
    name: { type: "string", required: true, description: "Fully-qualified DNS hostname." },
    type: { type: "string", required: true, description: "DNS record type.", enum: provider === "cloudflare" ? ["A", "AAAA", "CNAME", "TXT"] : ["A", "CNAME", "TXT"] },
    content: { type: "string", required: true, description: "Record target or text." },
    ttl: { type: "integer", default: provider === "cloudflare" ? 1 : 14400, description: "TTL in seconds; Cloudflare 1 means automatic." },
    ...(provider === "cloudflare" ? { proxied: { type: "boolean" as const, default: false, description: "Enable Cloudflare proxy for A/AAAA/CNAME." } } : {}),
  },
  steps: [
    { id: "verify", tool: "integration_execute", arguments: { user: ref("user"), provider, connection: ref("connection"), operation: "verify" }, expect: { path: "result.ok", equals: true } },
    { id: "dns", tool: "integration_execute", arguments: { user: ref("user"), provider, connection: ref("connection"), operation: provider + ".dns.upsert", confirm: true,
      arguments: { name: ref("name"), type: ref("type"), content: ref("content"), ttl: ref("ttl"), ...(provider === "cloudflare" ? { proxied: ref("proxied") } : {}) } } },
  ],
}));

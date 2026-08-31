import { INFRA_PROVIDER_IDS, type InfraProviderDefinition, type InfraProviderId, type InfraProviderValues } from "./types";

const definitions: Record<InfraProviderId, InfraProviderDefinition> = {
  dokploy: {
    id: "dokploy",
    title: "Dokploy",
    description: "Connect Dokploy and expose bounded project operations through its API.",
    feature: true,
    fields: [
      { key: "apiUrl", label: "API URL", secret: false, required: true, placeholder: "https://panel.example.com/api", description: "Dokploy panel URL. /api is appended when omitted." },
      { key: "apiKey", label: "API key", secret: true, required: true, description: "Dokploy API key. Stored only in MSO's owner-only infra store." },
      { key: "publicIp", label: "Public IPv4", secret: false, required: false, placeholder: "203.0.113.10", description: "Optional public VPS IPv4 used when creating DNS A records. Never derived from a loopback Dokploy URL." },
    ],
  },
  cloudflare: {
    id: "cloudflare",
    title: "Cloudflare",
    description: "Inspect zones and perform bounded per-record DNS changes; bulk zone writes are intentionally unavailable.",
    feature: true,
    fields: [
      { key: "apiToken", label: "API token", secret: true, required: true, description: "Cloudflare token scoped to Zone:Read + DNS:Edit for the intended zones." },
      { key: "zoneId", label: "Zone ID", secret: false, required: false, description: "Optional zone pin. MSO verifies the pinned zone still contains the requested hostname before writing." },
      { key: "accountId", label: "Account ID", secret: false, required: false, description: "Optional account identifier for future account-scoped operations." },
    ],
  },
  hostinger: {
    id: "hostinger",
    title: "Hostinger",
    description: "Hostinger portfolio/VPS verification and DNS record automation for domains hosted in hPanel.",
    feature: false,
    fields: [
      { key: "apiToken", label: "API token", secret: true, required: true, description: "Hostinger API token. DNS writes replace only the requested name/type RR-set." },
    ],
  },
};

export const isInfraProviderId = (value: string): value is InfraProviderId =>
  (INFRA_PROVIDER_IDS as readonly string[]).includes(value);

export const getInfraProviderDefinition = (id: InfraProviderId): InfraProviderDefinition => definitions[id];
export const listInfraProviderDefinitions = (): InfraProviderDefinition[] => INFRA_PROVIDER_IDS.map((id) => definitions[id]);

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const HEX32_RE = /^[0-9a-f]{32}$/i;

export function normalizeInfraValues(id: InfraProviderId, raw: Record<string, unknown>): InfraProviderValues {
  const def = definitions[id];
  const allowed = new Set(def.fields.map((field) => field.key));
  const out: InfraProviderValues = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    const clean = value.trim();
    if (clean) out[key] = clean;
  }
  if (id === "dokploy" && out.apiUrl) {
    let parsed: URL;
    try { parsed = new URL(out.apiUrl); } catch { throw new Error("Dokploy API URL must be an absolute http(s) URL"); }
    if (parsed.username || parsed.password) throw new Error("Dokploy API URL must not contain credentials");
    if (parsed.hash) throw new Error("Dokploy API URL must not contain a fragment");
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
      throw new Error("Dokploy API URL must use HTTPS, except loopback development URLs");
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    if (!parsed.pathname.endsWith("/api")) parsed.pathname = `${parsed.pathname === "/" ? "" : parsed.pathname}/api`;
    parsed.search = ""; parsed.hash = "";
    out.apiUrl = parsed.toString().replace(/\/$/, "");
    if (out.apiKey && out.apiKey.length < 20) throw new Error("Dokploy API key is too short");
    if (out.publicIp && !IPV4_RE.test(out.publicIp)) throw new Error("Dokploy publicIp must be a valid IPv4 address");
  }
  if (id === "cloudflare") {
    if (out.apiToken && out.apiToken.length < 24) throw new Error("Cloudflare API token is too short");
    if (out.zoneId && !HEX32_RE.test(out.zoneId)) throw new Error("Cloudflare zoneId must be 32 hexadecimal characters");
    if (out.accountId && out.accountId.length < 16) throw new Error("Cloudflare accountId is too short");
  }
  if (id === "hostinger" && out.apiToken && out.apiToken.length < 24) throw new Error("Hostinger API token is too short");
  return out;
}

import { isIP } from "node:net";
import { inspectCloudflareDns, listCloudflareZones, upsertCloudflareDns } from "./cloudflare";
import { readHostingerZone, upsertHostingerDns } from "./hostinger";
import { readInfraProvider } from "./store";
import { HOST_RE, obj, request } from "./http";
import type { AppDomainTarget, DomainProviderCapability, DomainProviderId } from "@/lib/contracts/app-domain";
import { redactText } from "@/lib/security/redact-text";

export type DomainRecordRequest = {
  provider: DomainProviderId;
  zoneName: string;
  hostnames: string[];
  target: AppDomainTarget;
};

export type DomainRecordResult = {
  provider: DomainProviderId;
  action: "created" | "updated" | "unchanged";
  records: Array<{ hostname: string; type: "A" | "CNAME"; recordId?: string }>;
};

type Action = DomainRecordResult["action"];
type RecordType = "A" | "CNAME";
type Writer = "cloudflare" | "hostinger";
type Normalized = { provider: DomainProviderId; zoneName: string; hostnames: string[]; type: RecordType; content: string };

const CAPABILITIES: Record<DomainProviderId, Omit<DomainProviderCapability, "id">> = {
  cloudflare: { aRecord: true, cname: true, txt: true, ingress: false },
  hostinger: { aRecord: true, cname: true, txt: true, ingress: false },
  dokploy: { aRecord: true, cname: false, txt: false, ingress: true },
  custom: { aRecord: false, cname: false, txt: false, ingress: false },
};

const HOSTINGER_API = "https://developers.hostinger.com/api";
const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\.$/, "");
const SECRET_KEYS = ["apiToken", "apiKey", "mailApiToken"] as const;

/**
 * Provider error text reaches a caller only after redaction. `redactText` catches `token: …`
 * shapes; a bare credential echoed without a label is scrubbed literally as well.
 */
async function fail(error: unknown): Promise<never> {
  let message = error instanceof Error ? error.message : String(error);
  const values = await Promise.all((["cloudflare", "hostinger", "dokploy"] as const)
    .map(async (id) => (await readInfraProvider(id).catch(() => ({}))) as Record<string, string>));
  for (const provider of values) {
    for (const key of SECRET_KEYS) {
      const secret = provider[key];
      if (secret && secret.length >= 8) message = message.split(secret).join("[redacted]");
    }
  }
  throw new Error(redactText(message, 500));
}

export function domainProviderCapabilities(id: DomainProviderId): DomainProviderCapability {
  const capability = CAPABILITIES[id];
  if (!capability) throw new Error(`unknown domain provider: ${String(id)}`);
  return { id, ...capability };
}

function normalizeRequest(input: DomainRecordRequest): Normalized {
  const { provider } = input;
  if (!Object.hasOwn(CAPABILITIES, provider)) throw new Error(`unknown domain provider: ${String(provider)}`);
  const zoneName = normalizeName(String(input.zoneName ?? ""));
  if (!HOST_RE.test(zoneName)) throw new Error("invalid zone name");
  const hostnames = [...new Set(input.hostnames.map(normalizeName))];
  if (!hostnames.length) throw new Error("at least one hostname is required");
  for (const hostname of hostnames) {
    if (!HOST_RE.test(hostname)) throw new Error(`invalid hostname: ${hostname}`);
    if (hostname !== zoneName && !hostname.endsWith(`.${zoneName}`)) throw new Error(`${hostname} is outside zone ${zoneName}`);
  }
  const target = input.target;
  if (target?.kind === "ipv4") {
    if (typeof target.value !== "string" || isIP(target.value) !== 4) throw new Error("A record target must be an IPv4 address");
    return { provider, zoneName, hostnames, type: "A", content: target.value };
  }
  if (target?.kind === "cname") {
    const content = normalizeName(String(target.value ?? ""));
    if (!HOST_RE.test(content)) throw new Error("CNAME target must be a hostname");
    return { provider, zoneName, hostnames, type: "CNAME", content };
  }
  throw new Error("target must be ipv4 or cname");
}

const aggregate = (actions: Action[]): Action =>
  actions.includes("created") ? "created" : actions.includes("updated") ? "updated" : "unchanged";

/**
 * Dokploy publishes ingress only, so DNS is written by whichever configured provider owns the
 * zone. Zero or several owners fail closed rather than picking one.
 */
async function dokployZoneProvider(zoneName: string): Promise<Writer> {
  const [cloudflare, hostinger] = await Promise.all([readInfraProvider("cloudflare"), readInfraProvider("hostinger")]);
  const owners: Writer[] = [];
  if (cloudflare.apiToken && (await listCloudflareZones(cloudflare)).some((zone) => zone.name === zoneName)) owners.push("cloudflare");
  if (hostinger.apiToken) {
    const res = await request(`${HOSTINGER_API}/domains/v1/portfolio`, { headers: { authorization: `Bearer ${hostinger.apiToken}`, accept: "application/json" } });
    if (!res.ok || !Array.isArray(res.body)) throw new Error(`Hostinger portfolio HTTP ${res.status}`);
    if (res.body.map(obj).some((row) => String(row.domain ?? "") === zoneName)) owners.push("hostinger");
  }
  if (!owners.length) throw new Error(`Dokploy cannot write DNS for ${zoneName}: configure Cloudflare or Hostinger for that zone, or use the custom provider`);
  if (owners.length > 1) throw new Error(`refusing ambiguous DNS ownership for ${zoneName}: both Cloudflare and Hostinger manage it`);
  return owners[0]!;
}

/** Missing credentials fail closed here, before any helper can fall through to a partial write. */
async function resolveWriter(req: Normalized): Promise<Writer> {
  if (req.provider === "cloudflare" || req.provider === "hostinger") {
    const values = await readInfraProvider(req.provider);
    if (!values.apiToken) throw new Error(`${req.provider === "cloudflare" ? "Cloudflare" : "Hostinger"} is not configured; run \`mso provider set ${req.provider}\``);
    return req.provider;
  }
  const values = await readInfraProvider("dokploy");
  if (!values.apiUrl || !values.apiKey) throw new Error("Dokploy is not configured; run `mso provider set dokploy`");
  if (req.type !== "A") throw new Error("Dokploy ingress publishes IPv4 A records only; select Cloudflare or Hostinger for a CNAME");
  if (!values.publicIp) throw new Error("Dokploy has no publicIp configured; set it in the Dokploy connection or use the custom provider");
  if (req.content !== values.publicIp) throw new Error("Dokploy A record target must equal the configured publicIp");
  return dokployZoneProvider(req.zoneName);
}

async function inspectHostingerRecord(zoneName: string, hostname: string, type: RecordType, content: string): Promise<Action> {
  const values = await readInfraProvider("hostinger");
  if (!values.apiToken) throw new Error("Hostinger is not configured; run `mso provider set hostinger`");
  const { root, rows } = await readHostingerZone(hostname, values.apiToken);
  if (root !== zoneName) throw new Error(`${hostname} is outside zone ${zoneName}`);
  const local = hostname === root ? "@" : hostname.slice(0, -(root.length + 1));
  const exact = rows.filter((row) => String(row.name ?? "") === local && String(row.type ?? "").toUpperCase() === type);
  if (exact.length > 1) throw new Error(`refusing ambiguous DNS change: ${exact.length} ${type} rows exist for ${hostname}`);
  if (!exact.length) return "created";
  const targets = Array.isArray(exact[0].records) ? exact[0].records.map(obj).map((row) => normalizeName(String(row.content ?? ""))) : [];
  return targets.length === 1 && targets[0] === normalizeName(content) ? "unchanged" : "updated";
}

export async function ensureDomainRecords(input: DomainRecordRequest): Promise<DomainRecordResult> {
  const req = normalizeRequest(input);
  if (req.provider === "custom") {
    return { provider: "custom", action: "unchanged", records: req.hostnames.map((hostname) => ({ hostname, type: req.type })) };
  }
  try {
    const writer = await resolveWriter(req);
    const actions: Action[] = [];
    const records: DomainRecordResult["records"] = [];
    for (const hostname of req.hostnames) {
      if (writer === "cloudflare") {
        const result = await upsertCloudflareDns({ name: hostname, type: req.type, content: req.content });
        actions.push(result.action as Action);
        records.push({ hostname, type: req.type, ...(result.id ? { recordId: result.id } : {}) });
      } else {
        const result = await upsertHostingerDns({ name: hostname, type: req.type, content: req.content });
        actions.push(result.action as Action);
        records.push({ hostname, type: req.type });
      }
    }
    return { provider: req.provider, action: aggregate(actions), records };
  } catch (error) {
    return fail(error);
  }
}

export async function inspectDomainRecords(input: DomainRecordRequest): Promise<DomainRecordResult["action"]> {
  const req = normalizeRequest(input);
  if (req.provider === "custom") return "unchanged";
  try {
    const writer = await resolveWriter(req);
    const actions: Action[] = [];
    for (const hostname of req.hostnames) {
      if (writer === "hostinger") {
        actions.push(await inspectHostingerRecord(req.zoneName, hostname, req.type, req.content));
        continue;
      }
      const records = await inspectCloudflareDns({ name: hostname, type: req.type });
      actions.push(!records.length ? "created" : normalizeName(records[0]!.content) === normalizeName(req.content) ? "unchanged" : "updated");
    }
    return aggregate(actions);
  } catch (error) {
    return fail(error);
  }
}

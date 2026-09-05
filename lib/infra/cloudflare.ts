import type { InfraProviderValues } from "./types";
import { readInfraProvider } from "./store";
import { HOST_RE, IPV4_RE, obj, request } from "./http";

const API = "https://api.cloudflare.com/client/v4";
const MAX_PAGE = 20;
const headers = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" });
const parsed = (body: unknown): { success: boolean; result: unknown } => {
  const value = obj(body);
  return { success: value.success === true, result: value.result };
};

export async function listCloudflareZones(candidate?: InfraProviderValues): Promise<Array<{ id: string; name: string }>> {
  const values = candidate ?? await readInfraProvider("cloudflare");
  if (!values.apiToken) throw new Error("Cloudflare is not configured; run `mso provider set cloudflare`");
  const out: Array<{ id: string; name: string }> = [];
  for (let page = 1; page <= MAX_PAGE; page++) {
    const res = await request(`${API}/zones?per_page=50&page=${page}`, { headers: headers(values.apiToken) });
    const body = parsed(res.body);
    if (!res.ok || !body.success || !Array.isArray(body.result)) throw new Error(`Cloudflare zones HTTP ${res.status}`);
    for (const row of body.result) {
      const item = obj(row); const id = String(item.id ?? ""); const name = String(item.name ?? "");
      if (id && name) out.push({ id, name });
    }
    const info = obj(obj(res.body).result_info);
    const totalPages = Number(info.total_pages ?? page);
    if (!Number.isFinite(totalPages) || page >= totalPages || body.result.length < 50) break;
  }
  return out;
}

export async function doctorCloudflare(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("cloudflare");
  if (!values.apiToken) return null;
  const verify = await request(`${API}/user/tokens/verify`, { headers: headers(values.apiToken) });
  if (!verify.ok || obj(verify.body).success !== true) throw new Error(`token verification HTTP ${verify.status}`);
  const zones = await listCloudflareZones(values);
  return `active token; ${zones.length} accessible zone(s)${zones.length ? `: ${zones.slice(0, 5).map((z) => z.name).join(", ")}` : ""}`;
}

async function zoneFor(fqdn: string): Promise<{ id: string; name: string; token: string }> {
  const values = await readInfraProvider("cloudflare");
  if (!values.apiToken) throw new Error("Cloudflare is not configured; run `mso provider set cloudflare`");
  const zones = await listCloudflareZones();
  const zone = values.zoneId
    ? zones.find((row) => row.id === values.zoneId)
    : zones.filter((row) => fqdn === row.name || fqdn.endsWith(`.${row.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
  if (values.zoneId && !zone) throw new Error("configured Cloudflare zoneId is not accessible to this token");
  if (!zone || !(fqdn === zone.name || fqdn.endsWith(`.${zone.name}`))) throw new Error(`no accessible Cloudflare zone contains ${fqdn}`);
  return { ...zone, token: values.apiToken };
}

function validateDns(name: string, type: string, content: string): void {
  if (!HOST_RE.test(name)) throw new Error("invalid DNS hostname");
  if (!["A", "AAAA", "CNAME", "TXT"].includes(type)) throw new Error("DNS type must be A, AAAA, CNAME, or TXT");
  if (type === "A" && !IPV4_RE.test(content)) throw new Error("A record content must be an IPv4 address");
  if (type === "AAAA" && (!content.includes(":") || !/^[0-9a-f:]+$/i.test(content))) throw new Error("AAAA record content must be an IPv6 address");
  if (type === "CNAME" && !HOST_RE.test(content.replace(/\.$/, ""))) throw new Error("CNAME content must be a hostname");
}

export async function upsertCloudflareDns(input: { name: string; type: string; content: string; proxied?: boolean; ttl?: number }): Promise<{ action: string; id: string; name: string; type: string }> {
  const name = input.name.trim().replace(/\.$/, "").toLowerCase();
  const type = input.type.trim().toUpperCase();
  const content = input.content.trim();
  validateDns(name, type, content);
  const zone = await zoneFor(name);
  const base = `${API}/zones/${encodeURIComponent(zone.id)}/dns_records`;
  const find = await request(`${base}?type=${encodeURIComponent(type)}&name.exact=${encodeURIComponent(name)}`, { headers: headers(zone.token) });
  const found = parsed(find.body);
  if (!find.ok || !found.success || !Array.isArray(found.result)) throw new Error(`Cloudflare record lookup HTTP ${find.status}`);
  const exact = found.result.map(obj).filter((r) => String(r.name ?? "").toLowerCase() === name && String(r.type ?? "").toUpperCase() === type);
  if (exact.length > 1) throw new Error(`refusing ambiguous DNS change: ${exact.length} ${type} records already exist for ${name}`);
  const proxied = ["A", "AAAA", "CNAME"].includes(type) ? input.proxied === true : undefined;
  const payload = { type, name, content, ttl: input.ttl && input.ttl >= 60 ? input.ttl : 1, ...(proxied === undefined ? {} : { proxied }) };
  if (exact.length === 1) {
    const current = exact[0];
    const same = String(current.content ?? "").replace(/\.$/, "") === content.replace(/\.$/, "") && (proxied === undefined || Boolean(current.proxied) === proxied);
    if (same) return { action: "unchanged", id: String(current.id), name, type };
    const id = String(current.id ?? "");
    if (!id) throw new Error("Cloudflare returned a DNS record without an id");
    const changed = await request(`${base}/${encodeURIComponent(id)}`, { method: "PATCH", headers: headers(zone.token), body: JSON.stringify(payload) });
    if (!changed.ok || !parsed(changed.body).success) throw new Error(`Cloudflare DNS PATCH HTTP ${changed.status}`);
    return { action: "updated", id, name, type };
  }
  const clashes = type === "CNAME" ? ["A", "AAAA"] : (["A", "AAAA"].includes(type) ? ["CNAME"] : []);
  for (const clash of clashes) {
    const check = await request(`${base}?type=${clash}&name.exact=${encodeURIComponent(name)}`, { headers: headers(zone.token) });
    const body = parsed(check.body);
    if (check.ok && body.success && Array.isArray(body.result) && body.result.some((r) => String(obj(r).name ?? "").toLowerCase() === name)) {
      throw new Error(`refusing DNS type replacement: ${name} already has ${clash}; remove it explicitly before creating ${type}`);
    }
  }
  const created = await request(base, { method: "POST", headers: headers(zone.token), body: JSON.stringify(payload) });
  const body = parsed(created.body); const row = obj(body.result);
  if (!created.ok || !body.success) throw new Error(`Cloudflare DNS POST HTTP ${created.status}`);
  return { action: "created", id: String(row.id ?? ""), name, type };
}

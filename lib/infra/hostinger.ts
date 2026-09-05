import type { InfraProviderValues } from "./types";
import { readInfraProvider } from "./store";
import { HOST_RE, IPV4_RE, obj, request } from "./http";
import { doctorHostingerMail } from "./hostinger-mail";

const API = "https://developers.hostinger.com/api";
const headers = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" });

export async function doctorHostinger(candidate?: InfraProviderValues): Promise<string | null> {
  const values = candidate ?? await readInfraProvider("hostinger");
  if (values.mailApiToken) return doctorHostingerMail(values);
  const mail = await doctorHostingerMail(values).catch(() => null);
  if (mail) return mail;
  if (!values.apiToken) return null;
  const res = await request(`${API}/vps/v1/virtual-machines`, { headers: headers(values.apiToken) });
  if (!res.ok) throw new Error(`Hostinger HTTP ${res.status}`);
  return `account token valid; ${Array.isArray(res.body) ? res.body.length : 0} VPS visible; Mail API unavailable for this token/account`;
}

async function rootFor(fullDomain: string, token: string): Promise<{ root: string; name: string }> {
  const res = await request(`${API}/domains/v1/portfolio`, { headers: headers(token) });
  if (!res.ok || !Array.isArray(res.body)) throw new Error(`Hostinger portfolio HTTP ${res.status}`);
  const roots = res.body
    .map(obj).map((row) => String(row.domain ?? "")).filter(Boolean)
    .filter((root) => fullDomain === root || fullDomain.endsWith(`.${root}`))
    .sort((a, b) => b.length - a.length);
  if (!roots[0]) throw new Error(`${fullDomain} is not in the Hostinger domain portfolio`);
  return { root: roots[0], name: fullDomain === roots[0] ? "@" : fullDomain.slice(0, -(roots[0].length + 1)) };
}

export async function upsertHostingerDns(input: { name: string; type: string; content: string; ttl?: number }): Promise<{ action: string; name: string; type: string }> {
  const values = await readInfraProvider("hostinger");
  if (!values.apiToken) throw new Error("Hostinger is not configured; run `mso provider set hostinger`");
  const fullDomain = input.name.trim().replace(/\.$/, "").toLowerCase();
  const type = input.type.trim().toUpperCase(); const content = input.content.trim();
  if (!HOST_RE.test(fullDomain)) throw new Error("invalid DNS hostname");
  if (!["A", "CNAME", "TXT"].includes(type)) throw new Error("Hostinger DNS type must be A, CNAME, or TXT");
  if (type === "A" && !IPV4_RE.test(content)) throw new Error("A record content must be an IPv4 address");
  if (type === "CNAME" && !HOST_RE.test(content.replace(/\.$/, ""))) throw new Error("CNAME content must be a hostname");
  const { root, name } = await rootFor(fullDomain, values.apiToken);
  const url = `${API}/dns/v1/zones/${encodeURIComponent(root)}`;
  const auth = headers(values.apiToken);
  const zone = await request(url, { headers: auth });
  if (!zone.ok || !Array.isArray(zone.body)) throw new Error(`Hostinger zone HTTP ${zone.status}`);
  const rows = zone.body.map((row) => ({ ...obj(row) }));
  const exact = rows.filter((row) => String(row.name ?? "") === name && String(row.type ?? "").toUpperCase() === type);
  if (exact.length > 1) throw new Error(`refusing ambiguous Hostinger DNS change: ${exact.length} ${type} rows exist for ${fullDomain}`);
  const conflicts = rows.filter((row) => String(row.name ?? "") === name && ((type === "CNAME" && ["A", "AAAA"].includes(String(row.type ?? "").toUpperCase())) || (["A", "AAAA"].includes(type) && String(row.type ?? "").toUpperCase() === "CNAME")));
  if (!exact.length && conflicts.length) throw new Error(`refusing DNS type replacement for ${fullDomain}; remove the conflicting record explicitly first`);
  const normalized = content.replace(/\.$/, "");
  if (exact.length === 1) {
    const targets = Array.isArray(exact[0].records) ? exact[0].records.map(obj).map((r) => String(r.content ?? "").replace(/\.$/, "")) : [];
    if (targets.length === 1 && targets[0] === normalized) return { action: "unchanged", name: fullDomain, type };
  }
  const record = { name, type, ttl: input.ttl && input.ttl >= 60 ? input.ttl : 14400, records: [{ content, is_disabled: false }] };
  // Hostinger's overwrite flag replaces only RRsets matching the supplied name+type.
  // Sending one RRset avoids a stale full-zone read/modify/write and cannot erase
  // an unrelated concurrent DNS change.
  const put = await request(url, { method: "PUT", headers: auth, body: JSON.stringify({ overwrite: true, zone: [record] }) });
  if (!put.ok) throw new Error(`Hostinger DNS PUT HTTP ${put.status}`);
  return { action: exact.length ? "updated" : "created", name: fullDomain, type };
}

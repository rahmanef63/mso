import type { ManagedDomainDnsResult, ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { obj } from "./http";
import { domainName, type CloudflareDomainClient } from "./managed-domain-client";

type DnsRecord = Record<string, unknown> & { id: string };
const dnsPath = (input: ManagedDomainRoute) => `/zones/${encodeURIComponent(input.zoneId)}/dns_records`;
const target = (input: ManagedDomainRoute) => `${input.tunnelId}.cfargotunnel.com`;
const matches = (record: DnsRecord, input: ManagedDomainRoute) => record.type === "CNAME"
  && domainName(record.content) === target(input) && record.proxied === true;

async function readRecord(client: CloudflareDomainClient, input: ManagedDomainRoute): Promise<DnsRecord | null> {
  const data = await client.call(`${dnsPath(input)}?name.exact=${encodeURIComponent(input.hostname)}&per_page=100`, "exact DNS lookup");
  if (!Array.isArray(data.result)) throw new Error("Cloudflare DNS lookup returned an invalid record list");
  const pages = Number(obj(data.result_info).total_pages ?? 1);
  if (!Number.isFinite(pages) || pages > 1 || data.result.length >= 100) throw new Error("Cloudflare DNS lookup is incomplete; refusing a partial ownership check");
  const records = data.result.map(obj);
  if (records.some(record => domainName(record.name) !== input.hostname)) throw new Error("Cloudflare exact DNS lookup returned another hostname");
  if (records.length > 1) throw new Error(`DNS conflict: multiple records occupy ${input.hostname}`);
  if (!records.length) return null;
  const record = records[0];
  if (typeof record.id !== "string" || !/^[a-f0-9]{32}$/.test(record.id)) throw new Error("Cloudflare DNS record has no usable identifier");
  return record as DnsRecord;
}

function assertCompatible(record: DnsRecord | null, input: ManagedDomainRoute): void {
  if (!record) return;
  if (record.type !== "CNAME") throw new Error(`DNS conflict: ${input.hostname} already has a non-CNAME record`);
  if (!matches(record, input) && record.comment !== input.ownerTag) {
    throw new Error(`DNS conflict: ${input.hostname} is not owned by this MSO app; its target and proxy settings were preserved`);
  }
}

export async function inspectManagedDomainDns(client: CloudflareDomainClient, input: ManagedDomainRoute): Promise<void> {
  assertCompatible(await readRecord(client, input), input);
}

export async function reconcileManagedDomainDns(client: CloudflareDomainClient, input: ManagedDomainRoute): Promise<ManagedDomainDnsResult> {
  const current = await readRecord(client, input);
  assertCompatible(current, input);
  if (current && matches(current, input)) return { id: current.id, action: "unchanged" };
  const payload = { type: "CNAME", name: input.hostname, content: target(input), proxied: true, ttl: 1, comment: input.ownerTag };
  const action = current ? "updated" : "created";
  let receipt;
  try {
    receipt = obj((await client.call(current ? `${dnsPath(input)}/${encodeURIComponent(current.id)}` : dnsPath(input),
      `DNS ${current ? "PATCH" : "POST"}`, { method: current ? "PATCH" : "POST", body: JSON.stringify(payload) })).result);
  } catch (error) {
    // A timed-out write can already be committed remotely; never repeat it blindly.
    const observed = await readRecord(client, input).catch(() => null);
    if (observed && matches(observed, input) && observed.comment === input.ownerTag) {
      return { id: observed.id, action: "unchanged" };
    }
    throw error;
  }
  const observed = await readRecord(client, input);
  if (!observed || !matches(observed, input) || observed.comment !== input.ownerTag
    || typeof receipt.id !== "string" || receipt.id !== observed.id || current && current.id !== observed.id) {
    throw new Error("Cloudflare DNS write could not be verified; retry to reconcile the existing record");
  }
  return { id: observed.id, action };
}

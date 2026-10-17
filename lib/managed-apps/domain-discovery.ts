import { listCloudflareZones } from "@/lib/infra/cloudflare";
import { readInfraProvider } from "@/lib/infra/store";
import { obj, request } from "@/lib/infra/http";
import { cleanDomainOrigin } from "./domain-config";
import type { ManagedDomainConfig } from "@/lib/contracts/managed-domains";

type DiscoveredDomainTarget = Pick<ManagedDomainConfig, "zoneId" | "zoneName" | "accountId" | "tunnelId" | "routeMode">;

export async function discoverManagedDomainTarget(publicOrigin: string, zoneHint?: string, tunnelHint?: string): Promise<DiscoveredDomainTarget> {
  const hostname = new URL(cleanDomainOrigin(publicOrigin)).hostname;
  const values = await readInfraProvider("cloudflare");
  if (!values.apiToken) throw new Error("Cloudflare connection is not configured; complete its private setup in MSO Integrations");
  const zones = (await listCloudflareZones(values)).filter(zone => hostname === zone.name || hostname.endsWith(`.${zone.name}`));
  const selected = zoneHint ?? values.zoneId;
  const zone = selected ? zones.find(zone => zone.id === selected || zone.name === selected) : zones.sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone) throw new Error("no selected accessible Cloudflare zone contains the MSO public origin");
  const base = "https://api.cloudflare.com/client/v4";
  const headers = { authorization: `Bearer ${values.apiToken}`, accept: "application/json" };
  const detail = await request(`${base}/zones/${encodeURIComponent(zone.id)}`, { headers });
  if (!detail.ok || obj(detail.body).success !== true) throw new Error(`Cloudflare zone inspection HTTP ${detail.status}`);
  const accountId = obj(obj(obj(detail.body).result).account).id;
  if (typeof accountId !== "string" || values.accountId && accountId !== values.accountId) throw new Error("selected Cloudflare zone does not match the connection account");
  let tunnelId = tunnelHint;
  if (!tunnelId) {
    const lookup = await request(`${base}/zones/${encodeURIComponent(zone.id)}/dns_records?type=CNAME&name.exact=${encodeURIComponent(hostname)}&per_page=100`, { headers });
    const data = obj(lookup.body);
    if (!lookup.ok || data.success !== true || !Array.isArray(data.result)) throw new Error(`Cloudflare cockpit DNS lookup HTTP ${lookup.status}`);
    const rows = data.result.map(obj).filter(row => row.name === hostname && row.type === "CNAME");
    if (Number(obj(data.result_info).total_pages ?? 1) > 1 || rows.length !== 1) throw new Error("cannot identify one existing MSO tunnel; specify --tunnel <UUID>");
    tunnelId = /^([a-f0-9-]{36})\.cfargotunnel\.com\.?$/.exec(String(rows[0].content))?.[1];
  }
  if (!tunnelId || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(tunnelId)) throw new Error("MSO DNS does not identify a Cloudflare Tunnel; specify --tunnel <UUID>");
  const tunnel = await request(`${base}/accounts/${encodeURIComponent(accountId)}/cfd_tunnel/${tunnelId}`, { headers });
  const data = obj(tunnel.body), result = obj(data.result);
  if (!tunnel.ok || data.success !== true || result.id !== tunnelId || result.deleted_at) throw new Error("cannot inspect the selected active Cloudflare tunnel");
  const routeMode = result.config_src === "cloudflare" ? "remote" : result.config_src === "local" ? "mso-gateway" : null;
  if (!routeMode) throw new Error("Cloudflare tunnel configuration source is unknown");
  return { zoneId: zone.id, zoneName: zone.name, accountId, tunnelId, routeMode };
}

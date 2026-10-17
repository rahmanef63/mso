import type { ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { obj, request } from "./http";
import { readInfraProvider } from "./store";

const API = "https://api.cloudflare.com/client/v4";
const ID = /^[a-f0-9]{32}$/i;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const domainName = (value: unknown): string => String(value ?? "").toLowerCase().replace(/\.$/, "");
export type CloudflareDomainClient = {
  tunnelPath: string;
  call: (resource: string, label: string, init?: RequestInit) => Promise<Record<string, unknown>>;
};

export function managedDomainOrigin(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port
    || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("managed domain origin must be the loopback MSO HTTP service with an explicit port");
  }
  return url.origin;
}

export async function managedDomainClient(input: ManagedDomainRoute): Promise<CloudflareDomainClient> {
  for (const name of [input.hostname, input.cockpitHostname, input.zoneName]) {
    if (!HOST.test(name) || name !== domainName(name)) throw new Error("managed domain hostnames must be normalized DNS names");
  }
  if (!ID.test(input.zoneId) || !ID.test(input.accountId) || !UUID.test(input.tunnelId)) throw new Error("invalid Cloudflare zone, account or tunnel identifier");
  if (input.hostname === input.cockpitHostname) throw new Error("an app domain cannot replace the MSO cockpit hostname");
  if (!input.hostname.endsWith(`.${input.zoneName}`)
    || !(input.cockpitHostname === input.zoneName || input.cockpitHostname.endsWith(`.${input.zoneName}`))) {
    throw new Error("managed domain and cockpit must belong to the selected Cloudflare zone");
  }
  if (input.ownerTag.length > 500 || !/^mso:[a-z0-9-]+:[a-z0-9-]+$/.test(input.ownerTag)) throw new Error("invalid managed DNS ownership marker");
  managedDomainOrigin(input.localOrigin);
  const values = await readInfraProvider("cloudflare");
  if (!values.apiToken) throw new Error("Cloudflare connection is not configured; complete its private setup in MSO Integrations");
  if (values.zoneId && values.zoneId !== input.zoneId || values.accountId && values.accountId !== input.accountId) {
    throw new Error("managed domain target differs from the selected Cloudflare connection");
  }
  const headers = { authorization: `Bearer ${values.apiToken}`, accept: "application/json", "content-type": "application/json" };
  return {
    tunnelPath: `/accounts/${encodeURIComponent(input.accountId)}/cfd_tunnel/${encodeURIComponent(input.tunnelId)}`,
    async call(resource, label, init = {}) {
      let response;
      try { response = await request(`${API}${resource}`, { ...init, headers }); }
      catch { throw new Error(`Cloudflare ${label} request failed; inspect connectivity and retry`); }
      const body = obj(response.body);
      if (!response.ok || body.success !== true) throw new Error(`Cloudflare ${label} HTTP ${response.status}`);
      return body;
    },
  };
}

export async function inspectManagedDomainIdentity(client: CloudflareDomainClient, input: ManagedDomainRoute): Promise<"remote" | "mso-gateway"> {
  const zone = obj((await client.call(`/zones/${encodeURIComponent(input.zoneId)}`, "zone inspection")).result);
  if (zone.id !== input.zoneId || domainName(zone.name) !== input.zoneName || obj(zone.account).id !== input.accountId) {
    throw new Error("Cloudflare zone ID, name and account do not match the managed domain configuration");
  }
  if (zone.status !== undefined && zone.status !== "active") throw new Error("selected Cloudflare zone is not active");
  const tunnel = obj((await client.call(client.tunnelPath, "tunnel inspection")).result);
  if (tunnel.id !== input.tunnelId || tunnel.deleted_at) throw new Error("selected Cloudflare tunnel is missing, deleted or mismatched");
  const mode = tunnel.config_src === "cloudflare" ? "remote" : tunnel.config_src === "local" ? "mso-gateway" : null;
  if (!mode) throw new Error("Cloudflare tunnel configuration source is unknown");
  if (mode !== (input.routeMode ?? "remote")) {
    throw new Error(`Cloudflare tunnel config_src=${String(tunnel.config_src)} requires ${mode} routing; run domain setup to inspect the existing owner without migrating the tunnel`);
  }
  return mode;
}

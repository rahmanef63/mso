import { isDeepStrictEqual } from "node:util";
import type { ManagedDomainRoute } from "@/lib/contracts/managed-domains";
import { obj } from "./http";
import { domainName, managedDomainOrigin, type CloudflareDomainClient } from "./managed-domain-client";

type Rule = Record<string, unknown>;
type Snapshot = { config: Record<string, unknown>; ingress: Rule[]; cockpit: Rule; targetIndex: number };

function matchesHost(rule: Rule, hostname: string): boolean {
  if (!rule.hostname || rule.hostname === "*") return true;
  const name = domainName(rule.hostname);
  return name === hostname || name.startsWith("*.") && hostname.endsWith(name.slice(1));
}

function assertService(rule: Rule, input: ManagedDomainRoute, label: string): void {
  let service;
  try { service = managedDomainOrigin(rule.service); } catch { /* A foreign service is a route conflict. */ }
  if (service !== managedDomainOrigin(input.localOrigin)) throw new Error(`${label} route does not point to the configured loopback MSO origin`);
}

function assertHostHeader(rule: Rule, config: Record<string, unknown>, hostname: string): void {
  const header = obj(rule.originRequest).httpHostHeader ?? obj(config.originRequest).httpHostHeader;
  if (header !== undefined && header !== "" && domainName(header) !== hostname) {
    throw new Error(`Tunnel originRequest.httpHostHeader would replace ${hostname}; correct that override before provisioning`);
  }
}

function singleHostRule(ingress: Rule[], hostname: string, required: boolean): number {
  const indices = ingress.flatMap((rule, index) => domainName(rule.hostname) === hostname ? [index] : []);
  if (indices.length > 1 || indices.some(index => Boolean(ingress[index].path))) throw new Error(`Tunnel route for ${hostname} is ambiguous or path-limited`);
  if (!indices.length) {
    if (required) throw new Error("the existing MSO cockpit must have one explicit whole-host tunnel route");
    return -1;
  }
  const index = indices[0];
  if (ingress.slice(0, index).some(rule => matchesHost(rule, hostname))) throw new Error(`Tunnel route for ${hostname} is shadowed by an earlier rule`);
  return index;
}

export async function inspectRemoteManagedDomain(client: CloudflareDomainClient, input: ManagedDomainRoute): Promise<Snapshot> {
  const result = obj((await client.call(`${client.tunnelPath}/configurations`, "tunnel configuration read")).result);
  if (result.source !== undefined && result.source !== "cloudflare" || result.tunnel_id !== undefined && result.tunnel_id !== input.tunnelId) {
    throw new Error("Cloudflare tunnel configuration identity or source changed");
  }
  const config = obj(result.config);
  if (!Array.isArray(config.ingress) || !config.ingress.length) throw new Error("Cloudflare tunnel has no valid ingress configuration");
  const ingress = config.ingress.map(obj);
  if (ingress.some(rule => typeof rule.service !== "string" || !rule.service)) throw new Error("Cloudflare tunnel contains an invalid ingress rule");
  const last = ingress[ingress.length - 1];
  if (last.hostname || last.path || ingress.slice(0, -1).some(rule => !rule.hostname && !rule.path)) {
    throw new Error("Cloudflare tunnel catch-all must be the final ingress rule");
  }
  const cockpitIndex = singleHostRule(ingress, input.cockpitHostname, true);
  const cockpit = ingress[cockpitIndex];
  assertService(cockpit, input, "MSO cockpit");
  assertHostHeader(cockpit, config, input.cockpitHostname);
  const targetIndex = singleHostRule(ingress, input.hostname, false);
  if (targetIndex >= 0) {
    assertService(ingress[targetIndex], input, "Existing app");
    assertHostHeader(ingress[targetIndex], config, input.hostname);
  } else {
    assertHostHeader({}, config, input.hostname);
  }
  return { config, ingress, cockpit, targetIndex };
}

export async function reconcileRemoteManagedDomain(client: CloudflareDomainClient, input: ManagedDomainRoute): Promise<{ action: "created" | "unchanged" }> {
  const before = await inspectRemoteManagedDomain(client, input);
  if (before.targetIndex >= 0) return { action: "unchanged" };
  const ingress = [...before.ingress];
  const originRequest = { ...obj(before.cockpit.originRequest) };
  if (originRequest.httpHostHeader) originRequest.httpHostHeader = input.hostname;
  const route = { ...before.cockpit, hostname: input.hostname, ...(before.cockpit.originRequest ? { originRequest } : {}) };
  const firstMatch = ingress.findIndex(rule => matchesHost(rule, input.hostname));
  ingress.splice(firstMatch, 0, route);
  const config = { ...before.config, ingress };
  await client.call(`${client.tunnelPath}/configurations`, "tunnel configuration PUT", { method: "PUT", body: JSON.stringify({ config }) });
  const observed = await inspectRemoteManagedDomain(client, input);
  if (observed.targetIndex < 0 || !isDeepStrictEqual(observed.config, config)) {
    throw new Error("Cloudflare tunnel update changed during verification; inspect concurrent changes before retrying");
  }
  return { action: "created" };
}

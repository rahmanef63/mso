import { isIP } from "node:net";
import type { ManagedDomainConfig, ManagedDomainState } from "@/lib/contracts/managed-domains";
import { MANAGED_APP_IDS } from "./types";

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const HEX = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CONFIG_KEYS = ["publicOrigin", "hostTemplate", "localOrigin", "zoneId", "zoneName", "accountId", "tunnelId", "user", "connection", "autoProvision"];
const RECORD_KEYS = ["appId", "hostname", "phase", "dnsRecordId", "dnsAction", "routeAction", "error", "verifiedAt", "updatedAt"];
const PHASES = new Set(["pending", "dns-ready", "route-ready", "ready", "blocked"]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid managed-domain configuration");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error("unknown managed-domain field; credentials belong in Integrations");
}
export function domainHostname(value: unknown): string {
  if (typeof value !== "string" || value.length > 253 || !value.includes(".") || isIP(value) ||
      value !== value.toLowerCase() || value.split(".").some(label => !LABEL.test(label))) throw new Error("invalid DNS hostname");
  return value;
}
export function cleanDomainOrigin(value: string, local = false): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("invalid domain origin"); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("domain origin must not contain credentials, a path, query or fragment");
  if (local) {
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || !url.port) throw new Error("domain target must be an HTTP loopback origin with an explicit port");
  } else {
    if (url.protocol !== "https:" || url.port) throw new Error("public origin must use HTTPS on port 443");
    domainHostname(url.hostname);
  }
  return url.origin;
}
export function managedDomainHostname(config: ManagedDomainConfig, appId: string): string {
  if (!(MANAGED_APP_IDS as readonly string[]).includes(appId)) throw new Error("unknown managed application");
  return domainHostname(config.hostTemplate.replace("{id}", appId));
}
export function validateDomainConfig(value: unknown): ManagedDomainConfig {
  const raw = object(value); keys(raw, [...CONFIG_KEYS, "routeMode"]);
  if (CONFIG_KEYS.some(key => key === "autoProvision" ? typeof raw[key] !== "boolean" : typeof raw[key] !== "string")) throw new Error("incomplete managed-domain configuration");
  if (raw.routeMode !== undefined && (typeof raw.routeMode !== "string" || !["remote", "mso-gateway"].includes(raw.routeMode))) throw new Error("invalid managed-domain route mode");
  const config = raw as unknown as ManagedDomainConfig;
  if (!HEX.test(config.zoneId) || !HEX.test(config.accountId) || !UUID.test(config.tunnelId)) throw new Error("zone/account IDs must be 32 lowercase hex characters; tunnel ID must be a UUID");
  if (!ID.test(config.user) || !ID.test(config.connection)) throw new Error("select a named MSO integration user and connection");
  if (cleanDomainOrigin(config.publicOrigin) !== config.publicOrigin || cleanDomainOrigin(config.localOrigin, true) !== config.localOrigin) throw new Error("domain origins must use their canonical spelling");
  domainHostname(config.zoneName);
  if (!config.hostTemplate.startsWith("{id}") || config.hostTemplate.split("{id}").length !== 2) throw new Error("host template must begin with exactly one {id}");
  const cockpit = new URL(config.publicOrigin).hostname;
  for (const host of [cockpit, ...MANAGED_APP_IDS.map(id => managedDomainHostname(config, id))]) {
    if (host !== config.zoneName && !host.endsWith(`.${config.zoneName}`)) throw new Error(`hostname is outside selected zone ${config.zoneName}`);
  }
  if (MANAGED_APP_IDS.some(id => managedDomainHostname(config, id) === cockpit)) throw new Error("application and cockpit origins must differ");
  return { ...config };
}
export function validateDomainState(value: unknown): ManagedDomainState {
  const raw = object(value); keys(raw, ["version", "revision", "ownerId", "config", "apps"]);
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || typeof raw.ownerId !== "string" || !UUID.test(raw.ownerId)) throw new Error("invalid managed-domain state; use the previous snapshot to recover");
  const config = raw.config === null ? null : validateDomainConfig(raw.config);
  const apps = object(raw.apps);
  for (const [id, value] of Object.entries(apps)) {
    const row = object(value); keys(row, RECORD_KEYS);
    if (!config || row.appId !== id || row.hostname !== managedDomainHostname(config, id) || typeof row.phase !== "string" || !PHASES.has(row.phase) || !Number.isSafeInteger(row.updatedAt)) throw new Error("invalid managed-domain application state");
    if (row.dnsRecordId !== undefined && (typeof row.dnsRecordId !== "string" || !HEX.test(row.dnsRecordId))) throw new Error("invalid domain DNS record ID");
    if (row.dnsAction !== undefined && (typeof row.dnsAction !== "string" || !["created", "updated", "unchanged"].includes(row.dnsAction))) throw new Error("invalid domain DNS action");
    if (row.routeAction !== undefined && (typeof row.routeAction !== "string" || !["created", "unchanged"].includes(row.routeAction))) throw new Error("invalid domain route action");
    if (row.error !== undefined && (typeof row.error !== "string" || row.error.length > 512)) throw new Error("invalid domain diagnostic");
    if (row.verifiedAt !== undefined && !Number.isSafeInteger(row.verifiedAt)) throw new Error("invalid domain verification timestamp");
  }
  return { ...raw, config } as unknown as ManagedDomainState;
}

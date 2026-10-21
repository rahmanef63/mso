import { isIP } from "node:net";
import { sessionCookieDomain } from "@/lib/auth/session-cookie";
import { DOMAIN_PROVIDER_IDS, type AppDomainErrorCode, type AppDomainRecord, type AppDomainTarget, type EnsureShellAppDomainInput } from "@/lib/contracts/app-domain";
import type { SurfaceApp } from "@/lib/contracts/surface-app";
import { domainProviderCapabilities, ensureDomainRecords, inspectDomainRecords } from "@/lib/infra/managed-domain-providers";
import { redactText } from "@/lib/security/redact-text";
import { configuredSurfaceApps } from "./config";
import { externalSurfaceSharesSession } from "./cookie-policy";
import { isHostname, readAppDomainState, mutateAppDomainState, withAppDomainOperation } from "./app-domain-store";

export type { AppDomainErrorCode, AppDomainPhase, AppDomainRecord, AppDomainTarget, DomainProviderId } from "@/lib/contracts/app-domain";
export class AppDomainError extends Error {
  constructor(readonly code: AppDomainErrorCode, readonly status: 400 | 404 | 409 | 503, message: string) { super(message); this.name = "AppDomainError"; }
}
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

function cockpitHostnames(): string[] {
  const hosts = [process.env.OS_PUBLIC_ORIGIN, process.env.OS_MCP_UI_ORIGIN].flatMap(value => {
    try { return value ? [new URL(value).hostname.replace(/\.$/, "").toLowerCase()] : []; } catch { return []; }
  });
  if (!hosts.length) throw new AppDomainError("provider_unavailable", 503, "MSO cockpit origin is not configured; refusing to publish a public name");
  return hosts;
}
/** Rejects an unsafe name with a precise reason. Never substitutes a different hostname. */
function assertHostname(value: unknown): string {
  if (!isHostname(value)) throw new AppDomainError("invalid_hostname", 400, "invalid DNS hostname");
  for (const cockpit of cockpitHostnames()) {
    if (cockpit === value || value.endsWith(`.${cockpit}`) || cockpit.endsWith(`.${value}`)) {
      throw new AppDomainError("invalid_hostname", 400, `${value} overlaps the MSO cockpit hostname ${cockpit}`);
    }
  }
  const shared = sessionCookieDomain(new Request(`https://${value}/`, { headers: { host: value } }));
  if (shared) throw new AppDomainError("invalid_hostname", 400, `${value} is inside OS_SESSION_COOKIE_DOMAIN ${shared} and would receive the MSO session cookie`);
  if (externalSurfaceSharesSession(`https://${value}`, cockpitHostnames())) {
    throw new AppDomainError("invalid_hostname", 400, `${value} shares the MSO session scope; use a separate host address`);
  }
  return value;
}
/** A zone apex legitimately CONTAINS the cockpit name, so only name syntax is checked here. */
function zoneFor(hostname: string, supplied: unknown): string {
  const labels = hostname.split(".");
  if (supplied === undefined && labels.length < 3) throw new AppDomainError("invalid_hostname", 400, `cannot derive a DNS zone from ${hostname}; supply zoneName`);
  const zoneName = supplied === undefined ? labels.slice(1).join(".") : supplied;
  if (!isHostname(zoneName)) throw new AppDomainError("invalid_hostname", 400, "invalid DNS zone name");
  if (hostname === zoneName || !hostname.endsWith(`.${zoneName}`)) throw new AppDomainError("invalid_hostname", 400, `${hostname} is outside zone ${String(zoneName)}`);
  return zoneName;
}
function assertTarget(value: unknown): AppDomainTarget {
  const target = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  if (target.kind === "ipv4" && typeof target.value === "string" && isIP(target.value) === 4) return { kind: "ipv4", value: target.value };
  if (target.kind === "cname" && isHostname(target.value)) return { kind: "cname", value: target.value };
  throw new AppDomainError("invalid_target", 400, "target must be a public IPv4 address or a DNS hostname");
}
/** The loopback origin that must answer before a public name exists. */
function localOriginOf(app: SurfaceApp): string {
  if (app.sessionUpstream) return app.sessionUpstream;
  const origin = new URL(app.origin);
  if (LOOPBACK.includes(origin.hostname) && origin.port) return origin.origin;
  throw new AppDomainError("invalid_target", 400, `shell app ${app.id} has no loopback origin to probe; connect it with a loopback target before publishing a public name`);
}
async function shellApp(appId: string): Promise<SurfaceApp> {
  if (!ID.test(appId)) throw new AppDomainError("app_not_found", 404, "unknown shell app");
  const app = (await configuredSurfaceApps()).find(entry => entry.id === appId && entry.placements?.includes("shell"));
  if (!app) throw new AppDomainError("app_not_found", 404, `no shell app ${appId}`);
  return app;
}
async function probeLocal(origin: string, hostname: string, appId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(new URL("/", origin), { headers: { host: hostname }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    throw new Error(`local origin ${origin} is not reachable for ${hostname}: ${error instanceof Error ? error.message : "request failed"}`);
  }
  await response.body?.cancel();
  // 401/403 still prove the route exists: MSO's proxy answers unauthenticated requests itself.
  const status = response.status;
  if (!((status >= 200 && status < 400) || status === 401 || status === 403)) {
    throw new Error(`local origin ${origin} does not serve shell app ${appId} at ${hostname} (HTTP ${status}); repair local routing before publishing DNS`);
  }
}

/**
 * Order is load-bearing: probe loopback -> write DNS -> confirm route -> verify. Every phase
 * transition is persisted before the next step, so a failed run resumes where it stopped
 * instead of restarting from `pending`, and a public name never points at an unready service.
 */
export async function ensureShellAppDomain(appId: string, input: EnsureShellAppDomainInput): Promise<AppDomainRecord> {
  const hostname = assertHostname(input.hostname), target = assertTarget(input.target);
  if (!(DOMAIN_PROVIDER_IDS as readonly string[]).includes(String(input.provider))) throw new AppDomainError("unsupported_provider", 400, `unknown domain provider: ${String(input.provider)}`);
  const app = await shellApp(appId), localOrigin = localOriginOf(app), zoneName = zoneFor(hostname, input.zoneName);
  const capability = domainProviderCapabilities(input.provider);
  if (input.provider !== "custom") {
    if (target.kind === "ipv4" && !capability.aRecord) throw new AppDomainError("unsupported_provider", 400, `${input.provider} cannot write A records`);
    if (target.kind === "cname" && !capability.cname) throw new AppDomainError("unsupported_provider", 400, `${input.provider} cannot write CNAME records`);
  }
  const request = { provider: input.provider, zoneName, hostnames: [hostname], target };

  return withAppDomainOperation(async () => {
    const apps = (await readAppDomainState()).apps, previous = apps[appId];
    const owner = Object.values(apps).find(row => row.hostname === hostname && row.appId !== appId);
    if (owner) throw new AppDomainError("domain_conflict", 409, `${hostname} is already assigned to shell app ${owner.appId}`);
    // Same name and provider is a resume, not a rebind; a different name starts over.
    const resuming = previous?.hostname === hostname && previous.provider === input.provider;
    if (resuming && previous.phase === "ready") return { ...previous };
    const current: AppDomainRecord = resuming ? { ...previous } : { appId, hostname, phase: "pending", provider: input.provider, updatedAt: Date.now() };
    delete current.error; delete current.verifiedAt;
    const persist = async (patch: Partial<AppDomainRecord>) => {
      Object.assign(current, patch, { updatedAt: Date.now() });
      await mutateAppDomainState(next => { next.apps[appId] = structuredClone(current); });
    };
    try {
      // A persisted dnsAction proves the probe and the DNS write already completed; repeating
      // them on resume would re-publish a record and re-probe a service that already answered.
      if (!previous?.dnsAction || !resuming) {
        await persist({ phase: "pending", localOrigin });
        await probeLocal(localOrigin, hostname, appId);
        const dns = await ensureDomainRecords(request);
        await persist({ phase: "dns-ready", dnsAction: dns.action, localOrigin });
        if (input.provider === "custom") {
          throw new Error(`operator-maintained DNS: create ${target.kind === "ipv4" ? "A" : "CNAME"} ${hostname} -> ${target.value}, then switch to a writable provider so MSO can verify it`);
        }
      }
      // The loopback proxy route was proved by the probe above; only dokploy adds its own ingress.
      await persist({ phase: "route-ready", routeAction: current.routeAction ?? "unchanged", localOrigin });
      const verified = await inspectDomainRecords(request);
      if (verified !== "unchanged") throw new Error(`DNS verification pending for ${hostname}: provider reports ${verified}; retry once propagation completes`);
      await persist({ phase: "ready", verifiedAt: Date.now() });
    } catch (error) {
      await persist({ phase: "blocked", error: redactText(error instanceof Error ? error.message : "domain provisioning failed", 512) });
    }
    return { ...current };
  });
}

export async function inspectShellAppDomain(appId: string): Promise<AppDomainRecord | null> {
  if (!ID.test(appId)) throw new AppDomainError("app_not_found", 404, "unknown shell app");
  return (await readAppDomainState()).apps[appId] ?? null;
}

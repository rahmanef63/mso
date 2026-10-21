// Shared domain-step logic for both shell-app entry paths (install + connect).
// MIRROR — source of truth: `lib/contracts/app-domain.ts`. The browser may not
// import that module (it is server-side), so `DomainProviderId`,
// `DomainProviderCapability`, `AppDomainPhase`, `AppDomainTarget` and
// `AppDomainRecord` are restated here with the SAME field names and SAME union
// members. `app-domain-parity.test.ts` fails when they drift; never add a field
// the server does not return.
export const DOMAIN_PROVIDER_IDS = ["cloudflare", "hostinger", "dokploy", "custom"] as const;
export type DomainProviderId = (typeof DOMAIN_PROVIDER_IDS)[number];
export type DomainProviderCapability = {
  id: DomainProviderId;
  aRecord: boolean;
  cname: boolean;
  txt: boolean;
  ingress: boolean;
};
export type AppDomainTarget = { kind: "ipv4"; value: string } | { kind: "cname"; value: string };
export type AppDomainPhase = "pending" | "dns-ready" | "route-ready" | "ready" | "blocked";
export type AppDomainRecord = {
  appId: string;
  hostname: string;
  phase: AppDomainPhase;
  provider: DomainProviderId | null;
  dnsAction?: "created" | "updated" | "unchanged";
  routeAction?: "created" | "unchanged";
  error?: string;
  localOrigin?: string;
  verifiedAt?: number;
  updatedAt: number;
};

// `custom` is not "cannot write": it means the operator writes the record. It
// stays selectable and the step prints what to create; marking it incapable
// would delete the only manual-DNS path. Everything else must be truthful about
// what it can create.
const CAPABILITIES: Record<DomainProviderId, DomainProviderCapability> = {
  cloudflare: { id: "cloudflare", aRecord: true, cname: true, txt: true, ingress: false },
  hostinger: { id: "hostinger", aRecord: true, cname: true, txt: true, ingress: false },
  dokploy: { id: "dokploy", aRecord: false, cname: false, txt: false, ingress: true },
  custom: { id: "custom", aRecord: false, cname: false, txt: false, ingress: false },
};

export const domainProviderCapabilities = (id: DomainProviderId): DomainProviderCapability => CAPABILITIES[id];
export const providerLabel = (id: DomainProviderId): string =>
  id === "custom" ? "Custom (you manage DNS)" : id.charAt(0).toUpperCase() + id.slice(1);

/** `recordType` is what the operator's target needs written. */
export function providerBlockReason(id: DomainProviderId, recordType: "A" | "CNAME"): string | null {
  if (id === "custom") return null;
  const capability = domainProviderCapabilities(id);
  if (recordType === "A" ? capability.aRecord : capability.cname) return null;
  return id === "dokploy"
    ? "Dokploy owns the ingress, not the DNS zone. Without a configured public IPv4 it cannot create this record, so nothing would be published."
    : `${providerLabel(id)} cannot create ${recordType} records.`;
}

export function targetFor(value: string): AppDomainTarget | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const octets = trimmed.split(".");
  if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return { kind: "ipv4", value: trimmed };
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(trimmed) ? { kind: "cname", value: trimmed } : null;
}

/** Only an IP:port address is a *direct* address. A hostname stays a domain step. */
export function directAddressFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return targetFor(parsed.hostname)?.kind === "ipv4" ? `${parsed.protocol}//${parsed.host}` : null;
  } catch { return null; }
}

/** Default hostname offered in the step: the app's own host when it is a real name. */
export function hostnameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const hostname = new URL(url).hostname;
    return targetFor(hostname)?.kind === "cname" ? hostname : "";
  } catch { return ""; }
}

export const DOMAIN_POLL_DEADLINE_MS = 120_000;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 8_000;

export type AppDomainPollOutcome =
  | { status: "settled"; record: AppDomainRecord }
  | { status: "deadline"; record: AppDomainRecord | null; error?: string }
  | { status: "cancelled"; record: AppDomainRecord | null };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
type PollOptions = {
  appId: string;
  signal?: AbortSignal;
  onRecord?: (record: AppDomainRecord) => void;
  /** Injection seams so the loop is testable without fake DOM timers. */
  fetchImpl?: Fetcher;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deadlineMs?: number;
};

const sleepFor = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// Bounded poll: exponential backoff, a hard deadline, and a hard stop the moment
// the record settles (ready/blocked) or the caller cancels. It never loops past
// the deadline even if every request hangs — the deadline check runs before each
// request and the wait is clamped to the remaining budget.
export async function pollAppDomain(options: PollOptions): Promise<AppDomainPollOutcome> {
  const fetcher = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepFor;
  const deadline = now() + (options.deadlineMs ?? DOMAIN_POLL_DEADLINE_MS);
  let record: AppDomainRecord | null = null;
  let error: string | undefined;
  let delay = BASE_DELAY_MS;
  while (true) {
    if (options.signal?.aborted) return { status: "cancelled", record };
    if (now() >= deadline) return { status: "deadline", record, error };
    try {
      const response = await fetcher(`/api/v1/shell-apps/${encodeURIComponent(options.appId)}/domain`, { cache: "no-store", signal: options.signal });
      if (response.ok) {
        const next = await response.json() as AppDomainRecord | null;
        if (next?.phase) {
          record = next;
          error = undefined;
          options.onRecord?.(next);
          if (next.phase === "ready" || next.phase === "blocked") return { status: "settled", record: next };
        }
      } else {
        error = `Domain status returned ${response.status}.`;
      }
    } catch (cause) {
      if (options.signal?.aborted) return { status: "cancelled", record };
      error = cause instanceof Error ? cause.message : "Could not read domain status.";
    }
    const wait = Math.min(delay, deadline - now());
    if (wait <= 0) return { status: "deadline", record, error };
    await sleep(wait);
    delay = Math.min(delay * 2, MAX_DELAY_MS);
  }
}

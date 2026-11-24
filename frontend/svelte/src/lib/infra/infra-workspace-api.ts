import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { canonicalInfraProviderId } from "./infra-api.ts";

export { ApiError, canonicalInfraProviderId };
export type { ShellBridge };

/** One Convex provider with a project dimension (#160). `convex-cloud` is a retired
 *  read alias; it must never become a second card, tab or row. */
export type ConvexProjectKind = "cloud" | "self-hosted";
export type InfraProviderRow = {
  id: string; label: string; configured: boolean;
  convexKind: ConvexProjectKind | null;
  fields: string[]; missing: string[];
};
export type DokployProject = { projectId: string; name: string };
export type CloudflareZone = { id: string; name: string };
export type DoctorResult = { id: string; ok: boolean | null; detail: string };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : []);

/** `summarizeInfraProvider` returns field OBJECTS; older payloads and fixtures send keys. */
const fieldKeys = (v: unknown): string[] => {
  if (!Array.isArray(v)) return [];
  return v.flatMap((item) => (typeof item === "string" ? [item] : isRecord(item) && nonEmpty(item.key) ? [item.key] : []));
};

export function infraStatusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to inspect infrastructure.";
  if (status === 429) return "Too many infrastructure requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return `${label} is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

/** The single infra transport: no-store, JSON-only, bounded per call (doctor is slow). */
export async function infraJson(
  path: string, method: "GET" | "POST", body: unknown, signal: AbortSignal,
  fetcher: typeof fetch, bridge: ShellBridge, label: string, timeoutMs = 25_000,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(infraStatusMessage(response.status, label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new ApiError(`The MSO ${label.toLowerCase()} response is invalid.`, 502); }
  if (!response.ok) throw new ApiError(infraStatusMessage(response.status, label), response.status);
  return payload;
}

function convexKind(raw: Record<string, unknown>, id: string): ConvexProjectKind | null {
  if (id !== "convex") return null;
  if (raw.deploymentKind === "self-hosted" || raw.deploymentKind === "cloud") return raw.deploymentKind;
  // A legacy row has no deploymentKind: a stored URL means self-hosted.
  const values = isRecord(raw.values) ? raw.values : null;
  return values && values.apiUrl ? "self-hosted" : "cloud";
}

function parseProvider(raw: unknown): InfraProviderRow {
  if (!isRecord(raw) || !nonEmpty(raw.id) || typeof raw.configured !== "boolean") {
    throw new ApiError("The MSO infrastructure providers response is invalid.", 502);
  }
  const id = canonicalInfraProviderId(raw.id.trim());
  const rawLabel = typeof raw.label === "string" ? raw.label.trim() : "";
  return {
    id,
    label: rawLabel === "Convex Cloud" && id === "convex" ? "Convex" : rawLabel || id,
    configured: raw.configured,
    convexKind: convexKind(raw, id),
    fields: fieldKeys(raw.fields),
    missing: stringList(raw.missing),
  };
}

/** Provider rows, one per canonical id. Cloud and self-hosted Convex merge into the
 *  single `convex` row; the project dimension survives as `convexKind`. */
export async function readInfraProviderRows(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<InfraProviderRow[]> {
  const payload = await infraJson("/api/v1/infra/providers", "GET", undefined, signal, fetcher, bridge, "Infrastructure providers");
  if (!isRecord(payload) || !Array.isArray(payload.providers)) {
    throw new ApiError("The MSO infrastructure providers response is invalid.", 502);
  }
  const merged = new Map<string, InfraProviderRow>();
  for (const item of payload.providers) {
    const row = parseProvider(item);
    const existing = merged.get(row.id);
    if (!existing) { merged.set(row.id, row); continue; }
    merged.set(row.id, {
      ...existing, configured: existing.configured || row.configured,
      convexKind: existing.convexKind ?? row.convexKind,
      fields: existing.fields.length ? existing.fields : row.fields,
      missing: existing.missing.length ? existing.missing : row.missing,
    });
  }
  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function readDokployProjects(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<DokployProject[]> {
  const payload = await infraJson("/api/v1/infra/dokploy/projects", "GET", undefined, signal, fetcher, bridge, "Dokploy projects");
  if (!isRecord(payload) || !Array.isArray(payload.projects)) {
    throw new ApiError("The MSO Dokploy projects response is invalid.", 502);
  }
  return payload.projects.flatMap((row) => (isRecord(row) && nonEmpty(row.projectId) && nonEmpty(row.name)
    ? [{ projectId: row.projectId, name: row.name }] : []));
}

export async function readCloudflareZones(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<CloudflareZone[]> {
  const payload = await infraJson("/api/v1/infra/cloudflare/zones", "GET", undefined, signal, fetcher, bridge, "Cloudflare zones");
  if (!isRecord(payload) || !Array.isArray(payload.zones)) {
    throw new ApiError("The MSO Cloudflare zones response is invalid.", 502);
  }
  return payload.zones.flatMap((row) => (isRecord(row) && nonEmpty(row.id) && nonEmpty(row.name)
    ? [{ id: row.id, name: row.name }] : []));
}

/** `id` omitted runs every provider. Results are keyed by canonical id, so callers can
 *  read one provider's verdict without trusting list order. */
export async function runInfraDoctor(
  id: string | null, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<DoctorResult[]> {
  const payload = await infraJson("/api/v1/infra/providers/doctor", "POST", id ? { id } : {},
    signal, fetcher, bridge, "Diagnostics", 60_000);
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new ApiError("The MSO diagnostics response is invalid.", 502);
  }
  return payload.results.flatMap((row) => {
    if (!isRecord(row) || !nonEmpty(row.id) || typeof row.detail !== "string") return [];
    const ok = row.ok === true ? true : row.ok === false ? false : null;
    return [{ id: canonicalInfraProviderId(row.id), ok, detail: row.detail }];
  });
}

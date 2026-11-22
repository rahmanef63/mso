import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type InfraProviderSummary = {
  id: string;
  label?: string;
  configured: boolean;
  fields?: string[];
  missing?: string[];
};

export type InfraProvidersSnapshot = {
  providers: InfraProviderSummary[];
};

export type InfraState =
  | { kind: "loading" }
  | { kind: "ready"; providers: InfraProviderSummary[] }
  | { kind: "error"; message: string; forbidden?: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";
const isOptStrArr = (v: unknown): v is string[] | undefined =>
  v === undefined || (Array.isArray(v) && v.every((item) => typeof item === "string"));

export function canonicalInfraProviderId(id: string): string {
  return id === "convex-cloud" ? "convex" : id;
}

function statusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to access infrastructure providers.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return "Infrastructure service is temporarily unavailable. Retry when ready.";
  return `Infrastructure request failed (${status}).`;
}

function validateProvider(raw: unknown): InfraProviderSummary {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || typeof raw.configured !== "boolean"
      || !isOptStr(raw.label) || !isOptStrArr(raw.fields) || !isOptStrArr(raw.missing)) {
    throw new ApiError("The MSO infrastructure providers response is invalid.", 502);
  }
  const canonicalId = canonicalInfraProviderId(raw.id.trim());
  const rawLabel = raw.label?.trim();
  const label = rawLabel === "Convex Cloud" && canonicalId === "convex" ? "Convex" : rawLabel;
  // Allowlisted metadata fields only; never retain credential values, tokens, or secrets.
  return {
    id: canonicalId,
    ...(label ? { label } : {}),
    configured: raw.configured,
    ...(raw.fields ? { fields: [...raw.fields] } : {}),
    ...(raw.missing ? { missing: [...raw.missing] } : {}),
  };
}

export async function readInfraProviders(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<InfraProvidersSnapshot> {
  const response = await fetcher(resolveApiUrl("/api/v1/infra/providers", bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  let payload: unknown;
  try { payload = await response.json(); } catch {
    throw new ApiError("The MSO infrastructure providers response is invalid.", 502);
  }
  if (!isRecord(payload) || !Array.isArray(payload.providers)) {
    throw new ApiError("The MSO infrastructure providers response is invalid.", 502);
  }
  const merged = new Map<string, InfraProviderSummary>();
  for (const item of payload.providers) {
    const provider = validateProvider(item);
    const existing = merged.get(provider.id);
    if (!existing) {
      merged.set(provider.id, provider);
    } else {
      merged.set(provider.id, {
        id: provider.id,
        ...(existing.label ?? provider.label ? { label: existing.label ?? provider.label } : {}),
        configured: existing.configured || provider.configured,
        ...(existing.fields ?? provider.fields ? { fields: existing.fields ?? provider.fields } : {}),
        ...(existing.missing ?? provider.missing ? { missing: existing.missing ?? provider.missing } : {}),
      });
    }
  }
  return { providers: [...merged.values()] };
}

export function createInfraController(
  update: (state: InfraState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const ctrl = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const snapshot = await readInfraProviders(ctrl.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", providers: snapshot.providers });
      } catch (error) {
        if (!disposed && run === generation && !ctrl.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load infrastructure providers. Check the backend and retry.",
            ...(forbidden ? { forbidden: true } : {}),
          });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

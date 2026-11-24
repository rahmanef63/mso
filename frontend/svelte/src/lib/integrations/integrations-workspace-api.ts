import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";
import { canonicalProviderId } from "./integrations-schema.ts";

export { ApiError, canonicalProviderId };
export type { ShellBridge };

export type IntegrationCatalogField = {
  key: string; label: string; secret: boolean; required: boolean; description: string; placeholder?: string;
};
export type IntegrationCatalogMethod = { id: string; label: string; scope: string; fields: IntegrationCatalogField[] };
export type IntegrationSourceId = "direct" | "composio" | "native-mcp";
export type IntegrationCatalogSource = { id: IntegrationSourceId; label: string; methods: IntegrationCatalogMethod[] };
export type IntegrationCatalogProvider = {
  id: string; title: string; description: string; sources: IntegrationCatalogSource[];
};

const SOURCE_IDS = new Set<IntegrationSourceId>(["direct", "composio", "native-mcp"]);

export const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return `Owner role is required to access ${label.toLowerCase()}.`;
  if (status === 409) return `${label} changed since it was opened. Reload and retry.`;
  if (status === 422) return `${label} was rejected by the provider. Check the values and retry.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return `${label} service is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

export type JsonRequest = { method: "GET" | "POST"; label: string; body?: unknown; authToken?: string; timeoutMs?: number };

/** One fetch seam for this feature: no-store, JSON-only, bounded by the caller's signal. */
export async function requestJson(
  path: string, options: JsonRequest, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.authToken) headers.Authorization = `Bearer ${options.authToken}`;
  let bodyText: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyText = JSON.stringify(options.body);
  }
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: options.method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 20_000)]), headers,
    ...(bodyText !== undefined ? { body: bodyText } : {}),
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, options.label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, options.label), response.status);
  try { return await response.json(); } catch {
    throw new ApiError(`The MSO ${options.label.toLowerCase()} response is invalid.`, 502);
  }
}

export function validateCatalogField(raw: unknown): IntegrationCatalogField {
  if (!isRecord(raw) || !isNonEmpty(raw.key) || !isNonEmpty(raw.label) || typeof raw.secret !== "boolean"
      || typeof raw.required !== "boolean" || typeof raw.description !== "string") {
    throw new ApiError("The MSO integrations catalog response is invalid.", 502);
  }
  return {
    key: raw.key, label: raw.label, secret: raw.secret, required: raw.required, description: raw.description,
    ...(isNonEmpty(raw.placeholder) ? { placeholder: raw.placeholder } : {}),
  };
}

function validateMethod(raw: unknown): IntegrationCatalogMethod {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.label) || typeof raw.scope !== "string"
      || !Array.isArray(raw.fields)) {
    throw new ApiError("The MSO integrations catalog response is invalid.", 502);
  }
  return { id: raw.id, label: raw.label, scope: raw.scope, fields: raw.fields.map(validateCatalogField) };
}

function validateProvider(raw: unknown): IntegrationCatalogProvider {
  if (!isRecord(raw) || !isNonEmpty(raw.id) || !isNonEmpty(raw.title) || typeof raw.description !== "string"
      || !Array.isArray(raw.sources)) {
    throw new ApiError("The MSO integrations catalog response is invalid.", 502);
  }
  let sources: IntegrationCatalogSource[] = raw.sources.map((source) => {
    if (!isRecord(source) || !SOURCE_IDS.has(source.id as IntegrationSourceId) || !isNonEmpty(source.label)
        || !Array.isArray(source.methods)) {
      throw new ApiError("The MSO integrations catalog response is invalid.", 502);
    }
    return { id: source.id as IntegrationSourceId, label: source.label, methods: source.methods.map(validateMethod) };
  });
  if (sources.length === 0) throw new ApiError("The MSO integrations catalog response is invalid.", 502);
  return { id: canonicalProviderId(raw.id), title: raw.title, description: raw.description, sources };
}

export type IntegrationCatalogState =
  | { kind: "loading" }
  | { kind: "ready"; providers: IntegrationCatalogProvider[] }
  | { kind: "error"; message: string; forbidden?: boolean };

export async function readIntegrationCatalog(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<IntegrationCatalogProvider[]> {
  const payload = await requestJson(
    "/api/v1/integrations?view=catalog", { method: "GET", label: "Integrations catalog" }, signal, fetcher, bridge,
  );
  if (!isRecord(payload) || !Array.isArray(payload.catalog)) {
    throw new ApiError("The MSO integrations catalog response is invalid.", 502);
  }
  // `convex-cloud` is a retired READ ALIAS: one Convex provider, one card, ever.
  const merged = new Map<string, IntegrationCatalogProvider>();
  for (const item of payload.catalog) {
    const provider = validateProvider(item);
    const existing = merged.get(provider.id);
    merged.set(provider.id, existing ? { ...existing, sources: [...existing.sources, ...provider.sources] } : provider);
  }
  return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function createIntegrationCatalogController(
  update: (state: IntegrationCatalogState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  return {
    async refresh() {
      if (disposed) return;
      const run = ++generation;
      active?.abort();
      const controller = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const providers = await readIntegrationCatalog(controller.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", providers });
      } catch (error) {
        if (!disposed && run === generation && !controller.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load the integrations catalog. Retry when ready.",
            ...(forbidden ? { forbidden } : {}),
          });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

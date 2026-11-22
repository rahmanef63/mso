import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type AppCatalogStatus = "remote" | "stale" | "unavailable";
export type ConnectedAppManifest = {
  id: string; name: string; description?: string; launchUrl?: string;
};
export type AppCatalogEntry =
  | { kind: "managed"; id: string }
  | { kind: "connected"; manifest: ConnectedAppManifest };
export type AppCatalogSnapshot = { status: AppCatalogStatus; entries: AppCatalogEntry[] };

export type ModularFeatureSummary = {
  id: string; title?: string; name?: string; version: string; description?: string;
};
export type ModularFeaturesSnapshot = { schemaVersion: 1; features: ModularFeatureSummary[] };

export type SkillSummary = {
  id: string; name: string; description: string; source: string; trust: string;
};
export type SkillRecipeSummary = {
  id: string; intent: string; summary?: string; successes?: number;
};
export type SkillsSnapshot = { skills: SkillSummary[]; recipes: SkillRecipeSummary[] };

export type AppStoreState =
  | { kind: "loading" }
  | { kind: "ready"; catalog: AppCatalogSnapshot }
  | { kind: "error"; message: string; forbidden?: boolean };

export type ExtensionsTab = "features" | "skills";
export type ExtensionsState =
  | { kind: "loading"; tab: ExtensionsTab }
  | { kind: "ready"; tab: ExtensionsTab; features: ModularFeatureSummary[]; skills: SkillSummary[]; recipes: SkillRecipeSummary[] }
  | { kind: "error"; tab: ExtensionsTab; message: string; forbidden?: boolean };

const CATALOG_STATUSES = new Set<AppCatalogStatus>(["remote", "stale", "unavailable"]);
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isOptStr = (v: unknown): v is string | undefined => v === undefined || typeof v === "string";

function statusMessage(status: number, label: string): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return `Owner role is required to access ${label.toLowerCase()}.`;
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 502 || status === 503) return `${label} service is temporarily unavailable. Retry when ready.`;
  return `${label} request failed (${status}).`;
}

async function fetchJson(
  path: string, label: string, signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge,
): Promise<unknown> {
  const response = await fetcher(resolveApiUrl(path, bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status, label), response.status);
  try { return await response.json(); } catch {
    throw new ApiError(`The MSO ${label.toLowerCase()} response is invalid.`, 502);
  }
}

function validateCatalogEntry(raw: unknown): AppCatalogEntry {
  if (!isRecord(raw)) throw new ApiError("The MSO app catalog response is invalid.", 502);
  if (raw.kind === "managed") {
    if (!isNonEmpty(raw.id)) throw new ApiError("The MSO app catalog response is invalid.", 502);
    return { kind: "managed", id: raw.id };
  }
  if (raw.kind === "connected" && isRecord(raw.manifest) && isNonEmpty(raw.manifest.id)
      && isNonEmpty(raw.manifest.name) && isOptStr(raw.manifest.description) && isOptStr(raw.manifest.launchUrl)) {
    return {
      kind: "connected",
      manifest: {
        id: raw.manifest.id, name: raw.manifest.name,
        ...(raw.manifest.description ? { description: raw.manifest.description } : {}),
        ...(raw.manifest.launchUrl ? { launchUrl: raw.manifest.launchUrl } : {}),
      },
    };
  }
  throw new ApiError("The MSO app catalog response is invalid.", 502);
}

export async function readAppCatalog(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<AppCatalogSnapshot> {
  const payload = await fetchJson("/api/v1/app-catalog", "App catalog", signal, fetcher, bridge);
  if (!isRecord(payload) || !CATALOG_STATUSES.has(payload.status as AppCatalogStatus) || !Array.isArray(payload.entries)) {
    throw new ApiError("The MSO app catalog response is invalid.", 502);
  }
  return { status: payload.status as AppCatalogStatus, entries: payload.entries.map(validateCatalogEntry) };
}

export async function readModularFeatures(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<ModularFeaturesSnapshot> {
  const payload = await fetchJson("/api/v1/features", "Modular features", signal, fetcher, bridge);
  if (!isRecord(payload) || payload.schemaVersion !== 1 || !Array.isArray(payload.features)) {
    throw new ApiError("The MSO modular features response is invalid.", 502);
  }
  const features = payload.features.map((item): ModularFeatureSummary => {
    if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.version)
        || !isOptStr(item.title) || !isOptStr(item.name) || !isOptStr(item.description)) {
      throw new ApiError("The MSO modular features response is invalid.", 502);
    }
    return {
      id: item.id, version: item.version,
      ...(item.title ? { title: item.title } : {}),
      ...(item.name ? { name: item.name } : {}),
      ...(item.description ? { description: item.description } : {}),
    };
  });
  return { schemaVersion: 1, features };
}

export async function readSkills(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<SkillsSnapshot> {
  const payload = await fetchJson("/api/skills", "Skills", signal, fetcher, bridge);
  if (!isRecord(payload) || !Array.isArray(payload.skills)
      || (payload.recipes !== undefined && !Array.isArray(payload.recipes))) {
    throw new ApiError("The MSO skills response is invalid.", 502);
  }
  const skills = payload.skills.map((item): SkillSummary => {
    if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.name)
        || typeof item.description !== "string" || !isNonEmpty(item.source) || !isNonEmpty(item.trust)) {
      throw new ApiError("The MSO skills response is invalid.", 502);
    }
    return { id: item.id, name: item.name, description: item.description, source: item.source, trust: item.trust };
  });
  const recipes = (payload.recipes ?? []).map((item): SkillRecipeSummary => {
    if (!isRecord(item) || !isNonEmpty(item.id) || !isNonEmpty(item.intent) || !isOptStr(item.summary)
        || (item.successes !== undefined && (typeof item.successes !== "number" || !Number.isInteger(item.successes) || item.successes < 0))) {
      throw new ApiError("The MSO skills response is invalid.", 502);
    }
    return {
      id: item.id, intent: item.intent,
      ...(item.summary ? { summary: item.summary } : {}),
      ...(item.successes !== undefined ? { successes: item.successes } : {}),
    };
  });
  return { skills, recipes };
}

export function createAppStoreController(
  update: (state: AppStoreState) => void, fetcher = fetch, bridge?: ShellBridge,
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
        const catalog = await readAppCatalog(ctrl.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", catalog });
      } catch (error) {
        if (!disposed && run === generation && !ctrl.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({ kind: "error", message: error instanceof ApiError ? error.message : "Could not load app catalog.", ...(forbidden ? { forbidden: true } : {}) });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

export function createExtensionsController(
  update: (state: ExtensionsState) => void, fetcher = fetch, bridge?: ShellBridge,
) {
  let generation = 0; let active: AbortController | undefined; let disposed = false;
  let tab: ExtensionsTab = "features";
  let features: ModularFeatureSummary[] = []; let skills: SkillSummary[] = []; let recipes: SkillRecipeSummary[] = [];
  async function load(targetTab: ExtensionsTab) {
    if (disposed) return;
    tab = targetTab;
    const run = ++generation;
    active?.abort();
    const ctrl = (active = new AbortController());
    update({ kind: "loading", tab });
    try {
      if (tab === "features") {
        const snap = await readModularFeatures(ctrl.signal, fetcher, bridge);
        if (!disposed && run === generation) { features = snap.features; update({ kind: "ready", tab, features, skills, recipes }); }
      } else {
        const snap = await readSkills(ctrl.signal, fetcher, bridge);
        if (!disposed && run === generation) { skills = snap.skills; recipes = snap.recipes; update({ kind: "ready", tab, features, skills, recipes }); }
      }
    } catch (error) {
      if (!disposed && run === generation && !ctrl.signal.aborted) {
        const forbidden = error instanceof ApiError && error.status === 403;
        update({ kind: "error", tab, message: error instanceof ApiError ? error.message : "Could not load extensions.", ...(forbidden ? { forbidden: true } : {}) });
      }
    }
  }
  return {
    refresh: () => load(tab),
    setTab: (nextTab: ExtensionsTab) => load(nextTab),
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

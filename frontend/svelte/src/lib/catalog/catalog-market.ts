// Reviewed skill market transport. Read-only by design: the catalog exposes what
// the reviewed market offers and what is already installed, but installation
// stays an explicit CLI/terminal action so no button can silently rewrite
// ~/.mso/skills.
import { ApiError } from "./catalog-api.ts";

export { ApiError };
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export type SkillMarketRow = {
  id: string; title: string; description: string; version: string; source: string;
  security: string; state: string; canInstall: boolean; canRemove: boolean;
};
export type SkillMarketSnapshot = { root: string; skills: SkillMarketRow[] };
export type SkillMarketState =
  | { kind: "loading" }
  | { kind: "ready"; market: SkillMarketSnapshot }
  | { kind: "error"; message: string; forbidden?: boolean };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const invalid = () => new ApiError("The MSO skill market response is invalid.", 502);

function statusMessage(status: number): string {
  if (status === 401) return "Your session is unavailable. Sign in and retry.";
  if (status === 403) return "Owner role is required to browse the skill market.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 400 || status === 502 || status === 503) return "The skill market is temporarily unavailable. Retry when ready.";
  return `Skill market request failed (${status}).`;
}

export function parseSkillMarket(payload: unknown): SkillMarketSnapshot {
  if (!isRecord(payload) || !Array.isArray(payload.skills) || payload.skills.length > 200) throw invalid();
  const skills = payload.skills.map((item): SkillMarketRow => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id
        || typeof item.title !== "string" || typeof item.description !== "string"
        || typeof item.version !== "string" || typeof item.source !== "string"
        || typeof item.security !== "string" || typeof item.state !== "string"
        || typeof item.canInstall !== "boolean" || typeof item.canRemove !== "boolean") throw invalid();
    return {
      id: item.id, title: item.title, description: item.description, version: item.version,
      source: item.source, security: item.security, state: item.state,
      canInstall: item.canInstall, canRemove: item.canRemove,
    };
  });
  return { root: typeof payload.root === "string" ? payload.root : "", skills };
}

export async function readSkillMarket(
  signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge(),
): Promise<SkillMarketSnapshot> {
  const response = await fetcher(resolveApiUrl("/api/v1/skill-market", bridge), {
    method: "GET", credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
  try {
    const payload = await response.json();
    // Offline demo and restricted builds answer 200 without a catalog. Say that
    // plainly instead of calling a healthy host response invalid.
    if (isRecord(payload) && payload.skills === undefined) {
      throw new ApiError("This build mode does not publish a reviewed skill market.", 501);
    }
    return parseSkillMarket(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  }
}

export function createSkillMarketController(
  update: (state: SkillMarketState) => void, fetcher = fetch, bridge?: ShellBridge,
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
        const market = await readSkillMarket(ctrl.signal, fetcher, bridge);
        if (!disposed && run === generation) update({ kind: "ready", market });
      } catch (error) {
        if (!disposed && run === generation && !ctrl.signal.aborted) {
          const forbidden = error instanceof ApiError && error.status === 403;
          update({
            kind: "error",
            message: error instanceof ApiError ? error.message : "Could not load the skill market.",
            ...(forbidden ? { forbidden: true } : {}),
          });
        }
      }
    },
    dispose() { disposed = true; generation++; active?.abort(); },
  };
}

export function matchesMarketRow(row: SkillMarketRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.title} ${row.id} ${row.description} ${row.source} ${row.state} ${row.security}`
    .toLowerCase().includes(q);
}

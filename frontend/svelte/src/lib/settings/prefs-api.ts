import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };
export type ThemeMode = "system" | "light" | "dark";
export type UpdateChannel = "stable" | "main";
export type Quicklink = { id: string; title: string; url: string };
export type PrefUpdates = { auto: boolean; channel: UpdateChannel };
export type PrefTweaks = { theme?: ThemeMode; reducedMotion?: boolean; reduceGlass?: boolean; highContrast?: boolean; fontScale?: number; preset?: string | null; wallpaper?: string; device?: "auto" | "desktop" | "phone"; [key: string]: unknown };
export type OsPrefs = { tweaks?: PrefTweaks; quicklinks?: Quicklink[]; updates?: PrefUpdates; updatedAt?: number };
export type PrefsPatch = { tweaks?: PrefTweaks; quicklinks?: Quicklink[] };
export type PrefsState =
  | { kind: "loading" }
  | { kind: "ready"; prefs: OsPrefs; saving: boolean; notice: string | null; actionError: string | null }
  | { kind: "error"; message: string };

const THEMES = new Set<ThemeMode>(["system", "light", "dark"]);
const CHANNELS = new Set<UpdateChannel>(["stable", "main"]);
const OWNER_ERR = "Owner role is required to update shared workspace preferences.";
const INVALID_RES = "The MSO preferences response is invalid.";
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const stripWallpaper = (t: Record<string, unknown>): PrefTweaks => { const { wallpaperStyle: _, ...rest } = t; return rest as PrefTweaks; };
const hostLabel = (url: string): string => new URL(url).hostname.replace(/^www\./, "");
export function isSafeQuicklinkUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw.trim()) return false;
  try { const u = new URL(raw.trim()); return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0; }
  catch { return false; }
}

function statusMessage(status: number, kind: "read" | "write"): string {
  if (status === 401 || status === 403) return kind === "write" ? OWNER_ERR : "Your session is unavailable or this device no longer has access.";
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  if (status === 400 && kind === "write") return "Preferences update was rejected. Check the fields and retry.";
  return kind === "write" ? `Preferences update failed (${status}).` : `Preferences request failed (${status}).`;
}

function parseTweaks(raw: unknown, status: number, message: string): PrefTweaks {
  if (!isRecord(raw)) throw new ApiError(message, status);
  const clean = stripWallpaper(raw);
  if ((clean.theme !== undefined && !THEMES.has(clean.theme))
    || (clean.reducedMotion !== undefined && typeof clean.reducedMotion !== "boolean")
    || (clean.reduceGlass !== undefined && typeof clean.reduceGlass !== "boolean")) throw new ApiError(message, status);
  return clean;
}

function validatePrefs(value: unknown): OsPrefs {
  if (!isRecord(value)) throw new ApiError(INVALID_RES, 502);
  const prefs: OsPrefs = {};
  if (value.tweaks !== undefined) prefs.tweaks = parseTweaks(value.tweaks, 502, INVALID_RES);
  if (value.quicklinks !== undefined) {
    if (!Array.isArray(value.quicklinks)) throw new ApiError(INVALID_RES, 502);
    prefs.quicklinks = value.quicklinks.flatMap((row): Quicklink[] => {
      if (!isRecord(row) || typeof row.id !== "string" || !row.id.trim() || typeof row.title !== "string" || !isSafeQuicklinkUrl(row.url)) return [];
      const url = row.url.trim();
      return [{ id: row.id.trim(), title: row.title.trim() || hostLabel(url), url }];
    });
  }
  if (value.updates !== undefined) {
    if (!isRecord(value.updates) || typeof value.updates.auto !== "boolean" || !CHANNELS.has(value.updates.channel as UpdateChannel)) throw new ApiError(INVALID_RES, 502);
    prefs.updates = { auto: value.updates.auto, channel: value.updates.channel as UpdateChannel };
  }
  if (value.updatedAt !== undefined) {
    if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt) || value.updatedAt < 0) throw new ApiError(INVALID_RES, 502);
    prefs.updatedAt = value.updatedAt;
  }
  return prefs;
}

async function requestPrefs(
  method: "GET" | "POST", signal: AbortSignal, fetcher: typeof fetch, bridge: ShellBridge, payload?: Record<string, unknown>,
): Promise<unknown> {
  const kind = method === "GET" ? "read" : "write";
  const res = await fetcher(resolveApiUrl("/api/prefs", bridge), {
    method, credentials: bridge.apiBaseOrigin ? "include" : "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (!res.ok) throw new ApiError(statusMessage(res.status, kind), res.status);
  if (!(res.headers.get("content-type")?.includes("application/json") ?? false)) throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  try { return await res.json(); } catch { throw new ApiError(INVALID_RES, 502); }
}

export const readPrefs = async (signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge()): Promise<OsPrefs> =>
  validatePrefs(await requestPrefs("GET", signal, fetcher, bridge));

export async function savePrefs(patch: PrefsPatch, signal: AbortSignal, fetcher = fetch, bridge: ShellBridge = detectShellBridge()): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.tweaks !== undefined) body.tweaks = parseTweaks(patch.tweaks, 400, "Invalid appearance preferences.");
  if (patch.quicklinks !== undefined) {
    const valid = Array.isArray(patch.quicklinks) && patch.quicklinks.every((q) =>
      isRecord(q) && typeof q.id === "string" && q.id.trim().length > 0 && typeof q.title === "string" && isSafeQuicklinkUrl(q.url));
    if (!valid) throw new ApiError("Quicklinks must use http or https URLs.", 400);
    body.quicklinks = patch.quicklinks.map((q) => ({ id: q.id.trim(), title: q.title.trim(), url: q.url.trim() }));
  }
  if (!body.tweaks && !body.quicklinks) throw new ApiError("Nothing to update.", 400);
  const res = await requestPrefs("POST", signal, fetcher, bridge, body);
  if (!isRecord(res) || res.ok !== true) throw new ApiError("The MSO preferences update response is invalid.", 502);
}

export function createPrefsController(update: (state: PrefsState) => void, fetcher = fetch, bridge?: ShellBridge) {
  let gen = 0, active: AbortController | undefined, disposed = false, current: OsPrefs | null = null;
  async function commit(patch: PrefsPatch, next: OsPrefs, notice: string): Promise<boolean> {
    if (disposed || !current) return false;
    const run = ++gen; active?.abort(); const ctrl = (active = new AbortController());
    update({ kind: "ready", prefs: current, saving: true, notice: null, actionError: null });
    try {
      await savePrefs(patch, ctrl.signal, fetcher, bridge);
      if (disposed || run !== gen) return false;
      current = next; update({ kind: "ready", prefs: next, saving: false, notice, actionError: null }); return true;
    } catch (e) {
      if (disposed || run !== gen || ctrl.signal.aborted) return false;
      update({ kind: "ready", prefs: current, saving: false, notice: null, actionError: e instanceof ApiError ? e.message : "Could not save preferences. Retry when reachable." });
      return false;
    }
  }
  return {
    async refresh() {
      if (disposed) return;
      const run = ++gen; active?.abort(); const ctrl = (active = new AbortController());
      update({ kind: "loading" });
      try {
        const prefs = await readPrefs(ctrl.signal, fetcher, bridge);
        if (disposed || run !== gen) return;
        current = prefs; update({ kind: "ready", prefs, saving: false, notice: null, actionError: null });
      } catch (e) {
        if (disposed || run !== gen || ctrl.signal.aborted) return;
        update({ kind: "error", message: e instanceof ApiError ? e.message : "Could not load preferences. Check the backend and retry." });
      }
    },
    saveTweaks(patch: PrefTweaks) {
      if (!current) return Promise.resolve(false);
      const merged = stripWallpaper({ ...(current.tweaks ?? {}), ...patch });
      return commit({ tweaks: merged }, { ...current, tweaks: merged }, "Appearance preferences saved.");
    },
    addQuicklink(title: string, url: string) {
      if (disposed || !current) return Promise.resolve(false);
      if (!isSafeQuicklinkUrl(url)) {
        update({ kind: "ready", prefs: current, saving: false, notice: null, actionError: "Enter a valid http:// or https:// URL." });
        return Promise.resolve(false);
      }
      const clean = url.trim();
      const quicklinks = [...(current.quicklinks ?? []), { id: crypto.randomUUID().slice(0, 8), title: title.trim() || hostLabel(clean), url: clean }];
      return commit({ quicklinks }, { ...current, quicklinks }, "Quicklink added.");
    },
    removeQuicklink: (id: string) => current
      ? commit({ quicklinks: (current.quicklinks ?? []).filter((q) => q.id !== id) }, { ...current, quicklinks: (current.quicklinks ?? []).filter((q) => q.id !== id) }, "Quicklink removed.")
      : Promise.resolve(false),
    dispose() { disposed = true; gen++; active?.abort(); },
  };
}

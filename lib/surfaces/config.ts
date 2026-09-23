import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { SurfaceApp, SurfacePlacement, SurfacePresentation, SurfaceEnvironment } from "@/lib/contracts/surface-app";
export type { SurfaceApp, SurfaceRenderer, SurfacePresentation, SurfaceEnvironment } from "@/lib/contracts/surface-app";

const MAX_APPS = 16;
const MAX_TEXT = 240;
const MAX_RAW_BYTES = 16_384;
const DEFAULT_REGISTRY = resolve(homedir(), ".mso", "surface-apps.json");
export function surfaceRegistryPath(): string {
  const value = process.env.MSO_SURFACE_APPS_FILE?.trim();
  if (!value) return DEFAULT_REGISTRY;
  // This is installation-owned runtime state, never an input to deployment tracing.
  return resolve(/* turbopackIgnore: true */ value === "~" ? homedir() : value.startsWith("~/") ? `${homedir()}/${value.slice(2)}` : value);
}
const SAFE_SANDBOX = new Set([
  "allow-downloads", "allow-forms", "allow-modals", "allow-orientation-lock",
  "allow-pointer-lock", "allow-popups", "allow-popups-to-escape-sandbox",
  "allow-presentation", "allow-same-origin", "allow-scripts",
]);
const PRESENTATIONS = new Set<SurfacePresentation>(["inline", "fullscreen", "pip"]);
const ENVIRONMENTS = new Set<SurfaceEnvironment>(["development", "preview", "production", "other"]);

function safeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 768 || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://surface.invalid");
    if (url.origin !== "https://surface.invalid" || url.search || url.hash || url.pathname.split("/").some((part) => part === "." || part === "..")) return null;
    return url.pathname;
  } catch { return null; }
}

function safeAuthPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.length > 768 || /[\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value, "https://surface.invalid");
    if (url.origin !== "https://surface.invalid" || url.username || url.password || url.hash || url.pathname.split("/").some((part) => part === "." || part === "..")) return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

function boundedText(value: unknown, required = false): string | undefined {
  if (typeof value !== "string") return required ? undefined : "";
  const result = value.trim();
  return result && result.length <= MAX_TEXT ? result : required ? undefined : "";
}

function parseApp(entry: unknown, seen: Set<string>): SurfaceApp | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown>;
  const id = boundedText(row.id, true), title = boundedText(row.title, true);
  const origin = safeOrigin(row.origin), startPath = safePath(row.startPath);
  const renderer = row.renderer, presentation = row.presentation, environment = row.environment;
  if (!id || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || seen.has(id) || !title || !origin || !startPath) return null;
  if (renderer !== "iframe" && renderer !== "remote") return null;
  if (!PRESENTATIONS.has(presentation as SurfacePresentation) || !ENVIRONMENTS.has(environment as SurfaceEnvironment)) return null;
  const sandbox = typeof row.sandbox === "string" ? row.sandbox.trim() : undefined;
  if (sandbox !== undefined && (sandbox.length > 240 || (sandbox.length > 0 && !sandbox.split(/\s+/).every((token) => SAFE_SANDBOX.has(token))))) return null;
  const externalAuthPath = row.externalAuthPath === undefined ? undefined : safeAuthPath(row.externalAuthPath);
  if (row.externalAuthPath !== undefined && !externalAuthPath) return null;
  const project = boundedText(row.project, true);
  if (row.project !== undefined && !project) return null;
  if (row.placements !== undefined && (!Array.isArray(row.placements) || row.placements.some((value) => value !== "workflows" && value !== "n8n" && value !== "mcp-page"))) return null;
  const placements = row.placements === undefined ? undefined : [...new Set(row.placements)] as SurfacePlacement[];
  seen.add(id);
  const reason = boundedText(row.reason);
  return {
    id, title, description: boundedText(row.description) ?? "", origin, startPath, renderer,
    presentation: presentation as SurfacePresentation, environment: environment as SurfaceEnvironment,
    ...(placements ? { placements } : {}), ...(project ? { project } : {}), ...(sandbox !== undefined ? { sandbox } : {}), ...(externalAuthPath ? { externalAuthPath } : {}), ...(reason ? { reason } : {}),
  };
}

async function readOwnerRegistry(): Promise<string | undefined> {
  try {
    // Owner-local runtime configuration is not a build asset or a project-wide glob.
    const raw = await fs.readFile(/* turbopackIgnore: true */ surfaceRegistryPath(), "utf8");
    return Buffer.byteLength(raw, "utf8") <= MAX_RAW_BYTES ? raw : undefined;
  } catch {
    return undefined;
  }
}

function parseRegistry(raw: string | undefined): SurfaceApp[] {
  if (!raw || Buffer.byteLength(raw, "utf8") > MAX_RAW_BYTES) return [];
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.slice(0, MAX_APPS).map((entry) => parseApp(entry, seen)).filter((app): app is SurfaceApp => app !== null);
}

/**
 * Per-instance reviewed Page registry. An explicitly defined env value remains a
 * backwards-compatible deployment override (including an intentionally empty value).
 * Otherwise the owner-local registry is read on every call so adding/removing a
 * reviewed surface does not require changing portable source or rebuilding MSO.
 */
export async function configuredSurfaceApps(raw = process.env.MSO_SURFACE_APPS_JSON): Promise<SurfaceApp[]> {
  return parseRegistry(raw !== undefined ? raw : await readOwnerRegistry());
}

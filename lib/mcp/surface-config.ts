export type SurfaceRenderer = "iframe" | "remote";
export type SurfacePresentation = "inline" | "fullscreen" | "pip";
export type SurfaceEnvironment = "development" | "preview" | "production" | "other";

export type SurfaceApp = {
  id: string;
  title: string;
  description: string;
  origin: string;
  startPath: string;
  renderer: SurfaceRenderer;
  presentation: SurfacePresentation;
  environment: SurfaceEnvironment;
  sandbox?: string;
  externalAuthPath?: string;
  reason?: string;
};

const MAX_APPS = 16;
const MAX_TEXT = 240;
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
  if (sandbox && (sandbox.length > 240 || !sandbox.split(/\s+/).every((token) => SAFE_SANDBOX.has(token)))) return null;
  const externalAuthPath = row.externalAuthPath === undefined ? undefined : safePath(row.externalAuthPath);
  if (row.externalAuthPath !== undefined && !externalAuthPath) return null;
  seen.add(id);
  const reason = boundedText(row.reason);
  return {
    id, title, description: boundedText(row.description) ?? "", origin, startPath, renderer,
    presentation: presentation as SurfacePresentation, environment: environment as SurfaceEnvironment,
    ...(sandbox ? { sandbox } : {}), ...(externalAuthPath ? { externalAuthPath } : {}), ...(reason ? { reason } : {}),
  };
}

export function configuredSurfaceApps(raw = process.env.MSO_SURFACE_APPS_JSON): SurfaceApp[] {
  if (!raw || raw.length > 16_384) return [];
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.slice(0, MAX_APPS).map((entry) => parseApp(entry, seen)).filter((app): app is SurfaceApp => app !== null);
}

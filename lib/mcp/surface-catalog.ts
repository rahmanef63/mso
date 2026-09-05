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

// This is deliberately code-owned rather than model/user-provided. Every nested
// frame origin becomes part of the MCP Apps CSP and therefore deserves review.
// Apps that deny framing remain useful through the remote-browser seam instead of
// having their X-Frame-Options/frame-ancestors stripped by MSO.
export const SURFACE_APPS: readonly SurfaceApp[] = [
  {
    id: "play-together",
    title: "Play Together",
    description: "Live Play Together demo through its dedicated /embed security boundary.",
    origin: "https://game.rahmanef.com",
    startPath: "/embed",
    externalAuthPath: "/?auth=google",
    renderer: "iframe",
    presentation: "inline",
    environment: "production",
    sandbox: "allow-scripts allow-same-origin allow-forms allow-pointer-lock",
  },
] as const;

const ROUTE_MAX = 1024;
const BASE = "https://mso-surface.invalid";

export type ResolvedSurface = {
  route: string;
  kind: "home" | "monitor" | "project" | "diff" | "browser" | "app" | "integrations";
  title: string;
  openPath: string;
  project?: string;
  sha?: string;
  app?: SurfaceApp & { url: string };
};

export function publicSurfaceApps(): Array<Omit<SurfaceApp, "sandbox" | "externalAuthPath">> {
  return SURFACE_APPS.map(({ sandbox: _sandbox, externalAuthPath: _externalAuthPath, ...app }) => ({ ...app }));
}

export function surfaceFrameDomains(): string[] {
  return [...new Set(SURFACE_APPS.filter((app) => app.renderer === "iframe").map((app) => app.origin))];
}

export function surfaceAppById(id: string): SurfaceApp | undefined {
  return SURFACE_APPS.find((app) => app.id === id);
}

function cleanRoute(raw: string): URL {
  if (!raw || raw.length > ROUTE_MAX || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f]/.test(raw)) {
    throw new Error("surface route must be a bounded absolute MSO-style path");
  }
  const url = new URL(raw, BASE);
  if (url.origin !== BASE) throw new Error("surface route cannot change origin");
  return url;
}

function safeDemoUrl(app: SurfaceApp, suffix: string, search: string): string {
  const base = app.startPath === "/" ? "" : app.startPath.replace(/\/$/, "");
  const path = suffix ? `${base}/${suffix}` : app.startPath;
  if (path.length > 768 || /[\\\u0000-\u001f]/.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("invalid demo path");
  }
  const url = new URL(`${path}${suffix ? search : ""}`, app.origin);
  if (url.origin !== app.origin || url.username || url.password || url.protocol !== "https:") throw new Error("demo URL escaped its trusted origin");
  return url.href;
}

export function resolveSurfaceRoute(rawRoute: string, context?: { project?: string; sha?: string }): ResolvedSurface {
  const url = cleanRoute(rawRoute);
  const decoded = decodeURIComponent(url.pathname);
  const parts = decoded.split("/").filter(Boolean);
  const route = `${url.pathname}${url.search}`;

  if (parts.length === 0) return { route, kind: "home", title: "MSO", openPath: "/assistant/mcp" };
  if (parts[0] === "integrations" && parts.length === 1) return { route, kind: "integrations", title: "Integrations", openPath: "/integrations" };
  if (parts[0] === "monitor" && parts.length === 1) return { route, kind: "monitor", title: "System Monitor", openPath: "/monitor" };
  if (parts[0] === "browser" && parts.length === 1) return { route, kind: "browser", title: "Remote Browser", openPath: "/browser" };
  if (parts[0] === "project" && parts.length === 1) return { route, kind: "project", title: "Project", openPath: "/files", ...(context?.project ? { project: context.project } : {}) };
  if (parts[0] === "diff" && parts.length === 1) return { route, kind: "diff", title: "Project Diff", openPath: "/code", ...(context?.project ? { project: context.project } : {}), ...(context?.sha ? { sha: context.sha } : {}) };

  if (parts[0] === "apps" && parts[1]) {
    const app = surfaceAppById(parts[1]);
    if (!app) throw new Error(`unknown MSO Page app: ${parts[1]}`);
    const suffix = parts.slice(2).join("/");
    return {
      route,
      kind: "app",
      title: app.title,
      openPath: app.renderer === "remote" ? "/browser" : "/assistant/mcp",
      app: { ...app, url: safeDemoUrl(app, suffix, url.search) },
    };
  }
  throw new Error(`unsupported MSO Page route: ${url.pathname}`);
}

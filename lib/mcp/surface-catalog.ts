import { configuredSurfaceApps, type SurfaceApp } from "./surface-config";
export type { SurfaceApp, SurfaceRenderer, SurfacePresentation, SurfaceEnvironment } from "./surface-config";

export async function surfaceApps(): Promise<readonly SurfaceApp[]> {
  return configuredSurfaceApps();
}

const ROUTE_MAX = 1024;
const BASE = "https://mso-surface.invalid";

export type ResolvedSurface = {
  route: string;
  kind:
    | "home"
    | "monitor"
    | "project"
    | "diff"
    | "browser"
    | "app"
    | "integrations";
  title: string;
  openPath: string;
  project?: string;
  sha?: string;
  app?: SurfaceApp & { url: string };
};

export async function publicSurfaceApps(): Promise<Array<
  Omit<SurfaceApp, "sandbox" | "externalAuthPath">
>> {
  return (await surfaceApps()).map(
    ({ sandbox: _sandbox, externalAuthPath: _externalAuthPath, ...app }) => ({
      ...app,
    }),
  );
}

export async function surfaceFrameDomains(): Promise<string[]> {
  return [
    ...new Set(
      (await surfaceApps())
        .filter((app) => app.renderer === "iframe")
        .map((app) => app.origin),
    ),
  ];
}

export async function surfaceAppById(id: string): Promise<SurfaceApp | undefined> {
  return (await surfaceApps()).find((app) => app.id === id);
}

function cleanRoute(raw: string): URL {
  if (
    !raw ||
    raw.length > ROUTE_MAX ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(raw)
  ) {
    throw new Error("surface route must be a bounded absolute MSO-style path");
  }
  const url = new URL(raw, BASE);
  if (url.origin !== BASE)
    throw new Error("surface route cannot change origin");
  return url;
}

function safeDemoUrl(app: SurfaceApp, suffix: string, search: string): string {
  const base = app.startPath === "/" ? "" : app.startPath.replace(/\/$/, "");
  const path = suffix ? `${base}/${suffix}` : app.startPath;
  if (
    path.length > 768 ||
    /[\\\u0000-\u001f]/.test(path) ||
    path.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error("invalid demo path");
  }
  const url = new URL(`${path}${suffix ? search : ""}`, app.origin);
  if (
    url.origin !== app.origin ||
    url.username ||
    url.password ||
    url.protocol !== "https:"
  )
    throw new Error("demo URL escaped its trusted origin");
  return url.href;
}

export async function resolveSurfaceRoute(
  rawRoute: string,
  context?: { project?: string; sha?: string },
): Promise<ResolvedSurface> {
  const url = cleanRoute(rawRoute);
  const decoded = decodeURIComponent(url.pathname);
  const parts = decoded.split("/").filter(Boolean);
  const route = `${url.pathname}${url.search}`;

  if (parts.length === 0)
    return { route, kind: "home", title: "MSO", openPath: "/assistant/mcp" };
  if (parts[0] === "integrations" && parts.length === 1)
    return {
      route,
      kind: "integrations",
      title: "Integrations",
      openPath: "/integrations",
    };
  if (parts[0] === "monitor" && parts.length === 1)
    return {
      route,
      kind: "monitor",
      title: "System Monitor",
      openPath: "/monitor",
    };
  if (parts[0] === "browser" && parts.length === 1)
    return {
      route,
      kind: "browser",
      title: "Remote Browser",
      openPath: "/browser",
    };
  if (parts[0] === "project" && parts.length === 1)
    return {
      route,
      kind: "project",
      title: "Project",
      openPath: "/files",
      ...(context?.project ? { project: context.project } : {}),
    };
  if (parts[0] === "diff" && parts.length === 1)
    return {
      route,
      kind: "diff",
      title: "Project Diff",
      openPath: "/code",
      ...(context?.project ? { project: context.project } : {}),
      ...(context?.sha ? { sha: context.sha } : {}),
    };

  if (parts[0] === "apps" && parts[1]) {
    const app = await surfaceAppById(parts[1]);
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

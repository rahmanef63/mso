import { type McpTool, S, str, opt, READ_ONLY } from "./tool-kit";
import { MSO_SURFACE_URI } from "./ui-surface";
import { publicSurfaceApps, resolveSurfaceRoute, type ResolvedSurface } from "./surface-catalog";

const APP_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, origin: { type: "string" },
    startPath: { type: "string" }, renderer: { type: "string", enum: ["iframe", "remote"] },
    presentation: { type: "string", enum: ["inline", "fullscreen", "pip"] }, reason: { type: "string" },
  },
  required: ["id", "title", "description", "origin", "startPath", "renderer", "presentation"],
  additionalProperties: false,
} as const;

const SURFACE_OUTPUT = {
  type: "object",
  properties: {
    route: { type: "string" }, kind: { type: "string", enum: ["home", "monitor", "project", "diff", "browser", "app"] },
    title: { type: "string" }, openPath: { type: "string" }, project: { type: "string" }, sha: { type: "string" },
    app: { type: "object" }, catalog: { type: "array", items: APP_SCHEMA },
  },
  required: ["route", "kind", "title", "openPath", "catalog"],
  additionalProperties: false,
} as const;

function publicResolved(resolved: ResolvedSurface): Record<string, unknown> {
  const { app, ...rest } = resolved;
  if (!app) return rest;
  const { sandbox: _sandbox, ...safeApp } = app;
  return { ...rest, app: safeApp };
}

export const SURFACE_TOOLS: McpTool[] = [
  {
    name: "mso_surface_apps_list",
    title: "List MSO Surface Apps",
    description: "List the small server-owned catalog of apps that MSO may present inside the ChatGPT MSO Surface. The model cannot add URLs or HTML to this catalog. Apps marked iframe have a reviewed exact frame origin; remote means the app keeps its own anti-framing policy and MSO will not strip it.",
    chatgptDescription: "List reviewed apps available to the ChatGPT MSO Surface, including whether each can be framed directly or must use the remote-browser seam.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({}),
    outputSchema: { type: "object", properties: { apps: { type: "array", items: APP_SCHEMA } }, required: ["apps"], additionalProperties: false },
    run: async () => ({ apps: publicSurfaceApps() }),
  },
  {
    name: "render_mso_surface",
    title: "Render MSO Surface",
    description: "Render the universal MSO Surface MCP App. Use an MSO-style route such as /, /monitor, /project, /diff, /browser, or /apps/<reviewed-app-id>. For project/diff views pass project separately. This tool never accepts raw HTML or arbitrary external URLs; demo origins are resolved only from the server-owned allowlist.",
    chatgptDescription: "Render the secure interactive MSO Surface in ChatGPT. Native routes: /, /monitor, /project, /diff, /browser; reviewed live demo: /apps/play-together. Raw HTML and arbitrary URLs are rejected.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({
      route: { type: "string", minLength: 1, maxLength: 1024, description: "MSO Surface route. External URLs are rejected." },
      project: { type: "string", description: "Project id/path/name for /project or /diff." },
      sha: { type: "string", description: "Optional commit SHA for /diff." },
    }, ["route"]),
    outputSchema: SURFACE_OUTPUT,
    meta: {
      ui: { resourceUri: MSO_SURFACE_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": MSO_SURFACE_URI,
      "openai/toolInvocation/invoking": "Opening MSO Surface…",
      "openai/toolInvocation/invoked": "MSO Surface opened",
      "openai/widgetAccessible": true,
    },
    run: async (a) => ({
      ...publicResolved(resolveSurfaceRoute(str(a, "route"), { project: opt(a, "project"), sha: opt(a, "sha") })),
      catalog: publicSurfaceApps(),
    }),
  },
];

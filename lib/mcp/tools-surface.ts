import { openIntegrationSetup } from "@/lib/infra/setup-capability";
import { INFRA_PROVIDER_IDS } from "@/lib/infra/types";
import { MSO_ORIGIN } from "./ui-config";
import { type McpTool, S, str, opt, READ_ONLY, mcpDirect } from "./tool-kit";
import { MSO_PAGE_URI } from "./ui-surface";
import { publicSurfaceApps, resolveSurfaceRoute, type ResolvedSurface } from "./surface-catalog";

const APP_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, origin: { type: "string" },
    startPath: { type: "string" }, renderer: { type: "string", enum: ["iframe", "remote"] },
    presentation: { type: "string", enum: ["inline", "fullscreen", "pip"] },
    environment: { type: "string", enum: ["development", "preview", "production", "other"] }, reason: { type: "string" },
  },
  required: ["id", "title", "description", "origin", "startPath", "renderer", "presentation", "environment"],
  additionalProperties: false,
} as const;

const PAGE_OUTPUT = {
  type: "object",
  properties: {
    route: { type: "string" }, kind: { type: "string", enum: ["home", "monitor", "project", "diff", "browser", "app", "integrations"] },
    title: { type: "string" }, openPath: { type: "string" }, project: { type: "string" }, sha: { type: "string" },
    setup: { type: "object" },
    app: { type: "object" }, catalog: { type: "array", items: APP_SCHEMA },
  },
  required: ["route", "kind", "title", "openPath", "catalog"],
  additionalProperties: false,
} as const;

const PAGE_INPUT = S({
  route: { type: "string", minLength: 1, maxLength: 1024, description: "MSO Page route. External URLs are rejected." },
  project: { type: "string", description: "Project id/path/name for /project or /diff." },
  sha: { type: "string", description: "Optional commit SHA for /diff." },
}, ["route"]);

function publicResolved(resolved: ResolvedSurface): Record<string, unknown> {
  const { app, ...rest } = resolved;
  if (!app) return rest;
  const { sandbox: _sandbox, ...safeApp } = app;
  return { ...rest, app: safeApp };
}

const renderPage = async (input: Record<string, unknown>) => ({
  ...publicResolved(resolveSurfaceRoute(str(input, "route"), { project: opt(input, "project"), sha: opt(input, "sha") })),
  catalog: publicSurfaceApps(),
});

export const SURFACE_TOOLS: McpTool[] = [
  {
    name: "integration_setup_open",
    title: "Open MSO Integration Setup",
    description: "Open a native MSO Integrations credential form in ChatGPT. Requires write scope. The user enters a key directly in the form, which sends it only to the MSO HTTPS server for validation and owner-only storage. Never pass credentials in tool arguments or chat. The provider-bound session expires after ten minutes and is consumed after a successful save. MSO needs no external credential plugin. Composio project and organization keys use different methods.",
    chatgptDescription: "Open native MSO Integrations in the Page. User enters keys in the form, never chat/tool arguments. Direct HTTPS validation, owner-only storage, ten-minute single-use setup. Composio project and organization keys are separate.",
    scope: "write",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: false },
    audit: { action: "infra.write", targetArg: "provider" },
    limit: { key: "integration.setup", max: 10, windowMs: 60_000 },
    inputSchema: S({ provider: { type: "string", enum: [...INFRA_PROVIDER_IDS] }, method: { type: "string", enum: ["direct", "project", "organization", "personal", "deployment"], description: "Composio defaults to project; other providers use direct." } }, ["provider"]),
    outputSchema: PAGE_OUTPUT,
    meta: {
      ui: { resourceUri: MSO_PAGE_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": MSO_PAGE_URI,
      "openai/widgetAccessible": true,
      "openai/toolInvocation/invoking": "Opening secure integration setup…",
      "openai/toolInvocation/invoked": "Secure setup form opened",
    },
    run: async (input, context) => {
      const grant = await openIntegrationSetup(str(input, "provider"), context.principal ?? context.actor ?? "", opt(input, "method"));
      const output = { route: "/integrations", kind: "integrations", title: "Integrations", openPath: "/integrations", catalog: publicSurfaceApps(), setup: grant.setup };
      return mcpDirect([{ type: "text", text: `Secure ${grant.setup.title} setup opened. Enter the credential in the form, never in chat.` }], false, output,
        { integrationSetup: { token: grant.token, endpoint: `${MSO_ORIGIN}/api/integrations/setup` } });
    },
  },
  {
    name: "mso_surface_apps_list",
    title: "List MSO Page Apps",
    description: "List the small server-owned catalog of development or production apps that MSO may present inside the ChatGPT Page. The model cannot add URLs or HTML to this catalog. Apps marked iframe have a reviewed exact frame origin; remote means the app keeps its own anti-framing policy and MSO will not strip it.",
    chatgptDescription: "List reviewed apps available to the ChatGPT MSO Page, including whether each can be framed directly or must use the remote-browser seam.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: S({}),
    outputSchema: { type: "object", properties: { apps: { type: "array", items: APP_SCHEMA } }, required: ["apps"], additionalProperties: false },
    run: async () => ({ apps: publicSurfaceApps() }),
  },
  {
    name: "render_mso_page",
    title: "Render MSO Page",
    description: "Render the full MSO Page MCP App for native operator views or reviewed development/production embeds. Use an MSO-style route such as /, /integrations, /monitor, /project, /diff, /browser, or /apps/<reviewed-app-id>. For project/diff views pass project separately. This tool never accepts raw HTML or arbitrary external URLs; iframe targets come only from the server-owned allowlist.",
    chatgptDescription: "Render the full secure MSO Page in ChatGPT. Native routes: /, /integrations, /monitor, /project, /diff, /browser; reviewed live demo: /apps/play-together. Raw HTML and arbitrary URLs are rejected.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: PAGE_INPUT,
    outputSchema: PAGE_OUTPUT,
    meta: {
      ui: { resourceUri: MSO_PAGE_URI, visibility: ["model", "app"] },
      "openai/outputTemplate": MSO_PAGE_URI,
      "openai/toolInvocation/invoking": "Opening MSO Page…",
      "openai/toolInvocation/invoked": "MSO Page opened",
      "openai/widgetAccessible": true,
    },
    run: renderPage,
  },
  {
    name: "render_mso_surface",
    title: "Render MSO Surface (Compatibility)",
    description: "Compatibility alias for older MSO Page widgets. New model calls must use render_mso_page.",
    chatgptDescription: "Compatibility-only app bridge for a cached MSO Surface. Use render_mso_page for new user-visible pages.",
    scope: "read", annotations: READ_ONLY,
    inputSchema: PAGE_INPUT,
    outputSchema: PAGE_OUTPUT,
    meta: {
      ui: { visibility: ["app"] },
      "openai/widgetAccessible": true,
    },
    run: renderPage,
  },
];

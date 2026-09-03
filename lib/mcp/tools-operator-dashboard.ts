import { stats, processes } from "@/lib/host";
import { camoufoxStatus } from "@/lib/camoufox/service";
import { listManagedApps } from "@/lib/managed-apps/manager";
import { INFRA_PROVIDER_IDS, readInfraProvider, summarizeInfraProvider } from "@/lib/infra";
import { type McpTool, S, READ_ONLY } from "./tool-kit";
import { VPS_STATUS_URI } from "./ui-resources";

const OUTPUT = {
  type: "object",
  properties: { health: { type: "object" }, processes: { type: "array" }, apps: { type: "array" }, browser: { type: "object" }, infrastructure: { type: "array" } },
  required: ["health", "processes", "apps", "browser", "infrastructure"], additionalProperties: false,
} as const;

export const OPERATOR_DASHBOARD_TOOLS: McpTool[] = [{
  name: "vps_status",
  title: "Open VPS Status",
  description: "Return one bounded operator overview of this VPS: health, top processes, managed apps, Camoufox state and masked infrastructure-provider readiness. This aggregates existing safe primitives without replacing them.",
  chatgptDescription: "Open one bounded VPS overview with health, processes, apps, browser and masked infrastructure readiness.",
  scope: "read", annotations: READ_ONLY,
  outputSchema: OUTPUT,
  meta: {
    ui: { resourceUri: VPS_STATUS_URI, visibility: ["model", "app"] },
    "openai/outputTemplate": VPS_STATUS_URI,
    "openai/toolInvocation/invoking": "Opening VPS status…",
    "openai/toolInvocation/invoked": "VPS status opened",
    "openai/widgetAccessible": true,
  },
  inputSchema: S({}),
  run: async () => {
    const [{ uptime, ...health }, top, apps, browser, infrastructure] = await Promise.all([
      stats(), processes(), listManagedApps(), camoufoxStatus(),
      Promise.all(INFRA_PROVIDER_IDS.map(async (id) => summarizeInfraProvider(id, await readInfraProvider(id)))),
    ]);
    return {
      health: { ...health, uptimeMs: Math.round(uptime), uptimeSeconds: Math.round(uptime / 1000) },
      processes: top, apps, browser: { installed: browser.installed, running: browser.running, autostart: browser.enabled }, infrastructure,
    };
  },
}];

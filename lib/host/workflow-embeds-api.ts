import type { SurfaceApp, WorkflowEmbed } from "@/lib/contracts/surface-app";
import { configuredSurfaceApps } from "@/lib/surfaces/config";
import { surfaceRegistrySnapshot } from "@/lib/surfaces/manage";

/** Presentation metadata only. An embed never inherits the cockpit's credentials. */
export function workflowEmbeds(apps: SurfaceApp[], cockpitOrigins: string[]): WorkflowEmbed[] {
  return apps.filter((app) => app.placements?.includes("workflows")).map((app) => {
    const ownOrigin = cockpitOrigins.includes(app.origin);
    return {
      id: app.id, title: app.title, description: app.description, origin: app.origin,
      url: new URL(app.startPath, app.origin).href,
      ...(app.externalAuthPath ? { loginUrl: new URL(app.externalAuthPath, app.origin).href } : {}),
      renderer: ownOrigin ? "remote" as const : app.renderer,
      sandbox: app.sandbox ?? "allow-scripts allow-same-origin allow-forms",
      ...(ownOrigin ? { reason: "Open the cockpit in a separate tab." } : app.reason ? { reason: app.reason } : {}),
    };
  });
}
function cockpitOrigins(requestOrigin: string): string[] {
  const origins = [requestOrigin];
  for (const value of [process.env.OS_PUBLIC_ORIGIN, process.env.OS_MCP_UI_ORIGIN]) {
    if (value) { try { origins.push(new URL(value).origin); } catch { /* Invalid config cannot grant framing. */ } }
  }
  return origins;
}

export async function listWorkflowEmbeds(requestOrigin: string): Promise<WorkflowEmbed[]> {
  return workflowEmbeds(await configuredSurfaceApps(), cockpitOrigins(requestOrigin));
}
export async function workflowEmbedSettings(requestOrigin: string) {
  const { apps, ...metadata } = await surfaceRegistrySnapshot();
  return { ...metadata, apps: workflowEmbeds(apps, cockpitOrigins(requestOrigin)) };
}

export { saveWorkflowSurface, SurfaceConfigError } from "@/lib/surfaces/manage";

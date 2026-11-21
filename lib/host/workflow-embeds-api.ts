import type { SurfaceApp, WorkflowEmbed } from "@/lib/contracts/surface-app";
import { configuredSurfaceApps } from "@/lib/surfaces/config";
import { externalSurfaceSharesSession } from "@/lib/surfaces/cookie-policy";
import { surfaceRegistrySnapshot } from "@/lib/surfaces/manage";

/** Presentation metadata only. An embed never inherits the cockpit's credentials. */
export function workflowEmbeds(apps: SurfaceApp[], cockpitOrigins: string[]): WorkflowEmbed[] {
  return apps.filter((app) => app.placements?.includes("workflows") || app.placements?.includes("n8n")).map((app) => {
    if (externalSurfaceSharesSession(app.origin, cockpitOrigins)) return {
      id: app.id, title: app.title, description: app.description, origin: app.origin,
      renderer: "remote" as const, sandbox: app.sandbox ?? "allow-scripts allow-same-origin allow-forms", blocked: true,
      reason: "Blocked: this editor would receive the MSO session cookie. Use an origin outside the cockpit cookie scope.",
    };
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

const DEFAULT_N8N_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-downloads";

/** Optional deployment-level HTTPS n8n URL (analogous to NINE_ROUTER_PUBLIC_URL).
 *  Used only when no explicit n8n entry is stored in the owner surface registry. */
export function envN8nSurfaceApp(raw = process.env.N8N_PUBLIC_URL): SurfaceApp | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  const startPath = url.pathname || "/";
  const afterScheme = trimmed.slice(trimmed.indexOf("://") + 3);
  const pathIndex = afterScheme.indexOf("/");
  const rawPath = pathIndex >= 0 ? afterScheme.slice(pathIndex) : "/";
  if (
    !startPath.startsWith("/") ||
    startPath.startsWith("//") ||
    startPath.length > 768 ||
    /[\\\u0000-\u001f]/.test(startPath) ||
    rawPath.split("/").some((part) => part === "." || part === "..") ||
    startPath.split("/").some((part) => part === "." || part === "..")
  ) return null;
  return {
    id: "n8n",
    title: "n8n",
    description: "n8n automation editor",
    origin: url.origin,
    startPath,
    renderer: "iframe",
    presentation: "inline",
    environment: "production",
    placements: ["n8n"],
    sandbox: DEFAULT_N8N_SANDBOX,
  };
}

function withEnvN8nFallback(apps: SurfaceApp[]): SurfaceApp[] {
  if (apps.some((app) => app.id === "n8n" || app.title.trim().toLowerCase() === "n8n")) return apps;
  const fallback = envN8nSurfaceApp();
  return fallback ? [...apps, fallback] : apps;
}

export async function listWorkflowEmbeds(requestOrigin: string): Promise<WorkflowEmbed[]> {
  return workflowEmbeds(withEnvN8nFallback(await configuredSurfaceApps()), cockpitOrigins(requestOrigin));
}
export async function workflowEmbedSettings(requestOrigin: string) {
  const { apps, ...metadata } = await surfaceRegistrySnapshot();
  return { ...metadata, apps: workflowEmbeds(withEnvN8nFallback(apps), cockpitOrigins(requestOrigin)) };
}

export { saveWorkflowSurface, SurfaceConfigError } from "@/lib/surfaces/manage";

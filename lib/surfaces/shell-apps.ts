import type { ShellAppDefinition, ShellAppSnapshot, ShellAppView } from "@/lib/contracts/shell-app";
import type { SurfaceApp } from "@/lib/contracts/surface-app";
import { configuredSurfaceApps } from "./config";
import { externalSurfaceSharesSession } from "./cookie-policy";
import { readSurfaceRegistry, registryRevision, mutateSurfaceRegistry, SurfaceConfigError } from "./registry-store";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SANDBOX = "allow-scripts allow-same-origin allow-forms";
const text = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function origins(requestOrigin: string) {
  return [requestOrigin, process.env.OS_PUBLIC_ORIGIN, process.env.OS_MCP_UI_ORIGIN].flatMap(value => {
    try { return value ? [new URL(value).origin] : []; } catch { return []; }
  });
}
function blocked(origin: string, requestOrigin: string) {
  const cockpit = origins(requestOrigin);
  return cockpit.includes(origin) || externalSurfaceSharesSession(origin, cockpit);
}
function definition(value: unknown): ShellAppDefinition {
  if (!object(value) || Object.keys(value).some(key => !["id", "title", "description", "url", "mode"].includes(key))) throw new SurfaceConfigError("invalid_shell_app");
  if (typeof value.id !== "string" || !ID.test(value.id) || !text(value.title, 120) ||
      typeof value.description !== "string" || value.description.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(value.description) ||
      !text(value.url, 2048) || !["embed", "tab"].includes(String(value.mode))) throw new SurfaceConfigError("invalid_shell_app");
  let url: URL;
  try { url = new URL(value.url as string); } catch { throw new SurfaceConfigError("invalid_app_url"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash ||
      /[\\\u0000-\u001f\u007f]/.test(value.url as string)) throw new SurfaceConfigError("plain_app_url_required");
  return { id: value.id, title: (value.title as string).trim(), description: value.description.trim(), url: url.href, mode: value.mode as "embed" | "tab" };
}
function view(app: SurfaceApp, requestOrigin: string): ShellAppView {
  const url = new URL(app.startPath, app.origin).href;
  const def: ShellAppDefinition = { id: app.id, title: app.title, description: app.description, url, mode: app.renderer === "iframe" ? "embed" : "tab" };
  const base = { id: app.id, title: app.title, description: app.description, origin: app.origin, sandbox: SANDBOX, definition: def };
  if (blocked(app.origin, requestOrigin)) return { ...base, renderer: "remote", blocked: true, reason: "This address shares MSO's session cookie scope. Use a separate host address." };
  const insecure = new URL(app.origin).protocol !== "https:";
  return { ...base, url, renderer: insecure ? "remote" : app.renderer,
    ...(insecure ? { reason: "HTTP apps open separately. Use an HTTPS address to embed this app." } : {}) };
}
export async function shellAppSettings(requestOrigin: string): Promise<ShellAppSnapshot> {
  const state = await readSurfaceRegistry();
  const apps = await configuredSurfaceApps(state.raw);
  return { schemaVersion: 1, revision: registryRevision(state.raw), configurable: !state.managedByEnvironment,
    apps: apps.filter(app => app.placements?.includes("shell")).map(app => view(app, requestOrigin)) };
}
export async function manageShellApp(input: Record<string, unknown>, requestOrigin: string) {
  if (input.schemaVersion !== 1 || input.confirm !== true ||
      Object.keys(input).some(key => !["schemaVersion", "action", "expectedRevision", "confirm", "app", "id"].includes(key)) ||
      !["add", "update", "remove"].includes(String(input.action))) throw new SurfaceConfigError("invalid_shell_request");
  const removing = input.action === "remove";
  if ((removing && input.app !== undefined) || (!removing && input.id !== undefined)) throw new SurfaceConfigError("invalid_shell_request");
  const app = removing ? undefined : definition(input.app);
  const id = app?.id ?? input.id;
  if (typeof id !== "string" || !ID.test(id)) throw new SurfaceConfigError("invalid_shell_app");
  const url = app ? new URL(app.url) : undefined;
  if (url && blocked(url.origin, requestOrigin)) throw new SurfaceConfigError("app_cookie_scope_conflict");
  const row = app && url ? {
    id, title: app.title, description: app.description, origin: url.origin, startPath: url.pathname,
    renderer: app.mode === "embed" && url.protocol === "https:" ? "iframe" : "remote",
    presentation: "inline", environment: "production", sandbox: SANDBOX, placements: ["shell"],
  } : undefined;
  if (row && (await configuredSurfaceApps(JSON.stringify([row]))).length !== 1) throw new SurfaceConfigError("invalid_shell_app");
  const result = await mutateSurfaceRegistry(input.expectedRevision, async entries => {
    const matches = entries.filter(entry => entry.id === id);
    if (input.action === "add" && matches.length) throw new SurfaceConfigError("app_id_exists", 409);
    if (input.action !== "add" && matches.length !== 1) throw new SurfaceConfigError("app_not_found_or_ambiguous", 409);
    if (matches.some(entry => !Array.isArray(entry.placements) || entry.placements.length !== 1 || entry.placements[0] !== "shell")) throw new SurfaceConfigError("app_owned_by_another_surface", 409);
    if (removing) return entries.filter(entry => entry.id !== id);
    return input.action === "add" ? [...entries, row!] : entries.map(entry => entry.id === id ? row! : entry);
  });
  return { ...result, id, schemaVersion: 1 };
}

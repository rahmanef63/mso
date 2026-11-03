import type { AppDescriptor } from "./types";

/** null defers a rewrite while a restored app is absent from the async registry. */
export function stateToUrl(apps: AppDescriptor[], appId: string | null, payload: unknown): string | null {
  if (!appId) return "/";
  const app = apps.find((entry) => entry.id === appId);
  if (!app) return null;
  const path = (payload as { path?: unknown } | null)?.path;
  const suffix = typeof path === "string" && path ? "/" + path.replace(/^\/+/, "") : "";
  return "/" + (app.slug ?? app.id) + suffix;
}

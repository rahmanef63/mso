import type { DeviceRole } from "./roles";

const VIEWER_APPS = new Set([
  "files-manager",
  "system-monitor",
  "media-viewer",
  "quicklinks",
  "docs",
  "os-settings",
]);
const OPERATOR_APPS = new Set([
  ...VIEWER_APPS,
  "camoufox-browser",
  "hermes",
  "openclaw",
  "9router",
]);

/** Unknown/runtime apps fail closed for delegated devices until explicitly classified. */
export function appAllowedForRole(appId: string, role: DeviceRole | null): boolean {
  if (role === "owner") return true;
  if (role === "operator") return OPERATOR_APPS.has(appId);
  return VIEWER_APPS.has(appId);
}

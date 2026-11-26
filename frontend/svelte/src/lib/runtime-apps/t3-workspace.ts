import { readManagedApps, safeDashboardUrl, type ManagedAppItem } from "../managed-apps/managed-apps-api.ts";

export const T3_CONNECT_URL = "https://app.t3.codes/";
export const T3_CONNECT_SANDBOX = "allow-forms allow-scripts allow-same-origin";

export function managedT3Dashboard(app: ManagedAppItem | null, cockpitOrigin: string): string | null {
  if (app?.id !== "t3" || !app.installed || !app.dashboardAvailable
      || app.state !== "running" || app.healthy === false) return null;
  const safe = safeDashboardUrl(app.publicDashboardUrl);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== "https:" || url.origin === cockpitOrigin || url.search || url.hash) return null;
  // Managed dashboard links leave MSO; never point an iframe at an API-provided URL.
  return url.href;
}

export async function readManagedT3(signal: AbortSignal, fetcher = fetch): Promise<ManagedAppItem | null> {
  return (await readManagedApps(signal, fetcher)).find((app) => app.id === "t3") ?? null;
}

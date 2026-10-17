import { managedAppUpstream } from "./upstream-target";
import type { ManagedAppDefinition } from "./types";

export async function managedAppHealth(definition: ManagedAppDefinition): Promise<boolean | null> {
  try {
    const base = managedAppUpstream(definition.dashboardUrl);
    const target = new URL(definition.healthPath ?? "/health", base);
    if (target.origin !== base.origin) return null;
    const response = await fetch(target, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return null; }
}

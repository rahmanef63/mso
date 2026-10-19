import { getOrcaReadiness } from "./orca-readiness";
import { managedAppUpstream } from "./upstream-target";
import type { ManagedAppDefinition } from "./types";

/** A static 200 on the web bundle proves reachability, not ownership. Orca's
 *  health is the bridge's fail-closed live reading: the exact readiness tag, the
 *  runtime-identity receipt, and the verified owned kernel process must agree. */
async function orcaHealth(): Promise<boolean | null> {
  try {
    return (await getOrcaReadiness()).available;
  } catch {
    return null;
  }
}

export async function managedAppHealth(definition: ManagedAppDefinition): Promise<boolean | null> {
  if (definition.id === "orca") return orcaHealth();
  try {
    const base = managedAppUpstream(definition.dashboardUrl);
    const target = new URL(definition.healthPath ?? "/health", base);
    if (target.origin !== base.origin) return null;
    const response = await fetch(target, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(4_000) });
    await response.body?.cancel();
    return response.ok;
  } catch { return null; }
}

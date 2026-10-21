import { managedAppUpstream } from "./upstream-target";
import type { ManagedAppDefinition } from "./types";

/** A static 200 on the web bundle proves reachability, not ownership. Orca's
 *  health is the bridge's fail-closed live reading: the exact readiness tag, the
 *  runtime-identity receipt, and the verified owned kernel process must agree.
 *
 *  The bridge is server-only (it reads the private store and `/proc`). It is
 *  loaded on demand rather than at module top level so the shared domain CLI
 *  (`mso domain status`/`help`) does not pull the Next-only `server-only` marker
 *  into its Bun/Node import graph. Where the bridge cannot load in that runtime,
 *  health fails closed as `null` instead of crashing. */
async function orcaHealth(): Promise<boolean | null> {
  try {
    const { getOrcaReadiness } = await import("./orca-readiness");
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

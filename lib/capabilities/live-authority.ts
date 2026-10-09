import type { CapabilityRunContext } from "./tool";
import { clampScope } from "./scope-policy";
import { getApprovedDevice } from "@/lib/auth/device-store";

/** Async workers retain the initiating grant, never a snapshot of its validity. */
export async function liveCapabilityContext(context: CapabilityRunContext, name?: string, args?: Record<string, unknown>): Promise<CapabilityRunContext> {
  if (context.principal?.startsWith("web:")) {
    const device = await getApprovedDevice(context.principal.slice(4));
    if (!device || device.role === "viewer" || context.scope === "exec" && device.role !== "owner") throw new Error("execution device revoked or demoted");
  }
  if (context.authorizationGrant && (!context.principal || !await context.capabilities?.authorize?.(context.authorizationGrant, context.principal, name, args))) {
    throw new Error("execution authorization revoked, expired or changed");
  }
  return { ...context, scope: clampScope(context.scope) };
}

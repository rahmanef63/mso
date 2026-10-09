import { getApprovedDevice } from "@/lib/auth/device-store";
import { roleAtLeast } from "@/lib/auth/roles";
import { liveCapabilityContext } from "@/lib/capabilities/live-authority";
import { allows, scopeRank, type Scope } from "@/lib/capabilities/scope";
import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import { configuredCapabilityCeiling } from "@/lib/capabilities/scope-policy";
import type { WorkflowGraphRun } from "@/lib/contracts/workflow-graph";

/** Stored graphs are data, not grants. Recheck device authority for every action. */
export async function workflowExecutionContext(
  context: CapabilityRunContext,
  trigger?: WorkflowGraphRun["trigger"],
): Promise<CapabilityRunContext> {
  const principal = context.principal ?? context.actor;
  if (!principal) throw new Error("workflow requires an authenticated principal");
  const unattended = trigger && ["schedule", "webhook", "channel"].includes(trigger.type);
  if (unattended && !principal.startsWith("web:")) {
    throw new Error("unattended workflow requires a live approved device; stored client names are not execution grants");
  }
  let ceiling = configuredCapabilityCeiling();
  let allowedTools = context.allowedTools;
  let toolArgumentConstraints = context.toolArgumentConstraints;
  if (principal.startsWith("web:")) {
    const device = await getApprovedDevice(principal.slice(4));
    if (!device || device.role === "viewer") throw new Error("workflow device is revoked or lacks operator authority");
    const roleScope: Scope = device.role === "owner" ? "exec" : "write";
    if (scopeRank(roleScope) < scopeRank(ceiling)) ceiling = roleScope;
    if (device.role === "operator") {
      // New write tools default to Owner until their bounded Operator parity is reviewed.
      const permitted = [...(context.capabilities?.list("read") ?? []).filter((tool) => tool.scope === "read").map((tool) => tool.name), "apps_power"];
      const priorTools = allowedTools;
      allowedTools = priorTools ? permitted.filter((name) => priorTools.includes(name)) : permitted;
      const actions = ["start", "stop", "restart", "backup"];
      const prior = toolArgumentConstraints?.apps_power?.action;
      toolArgumentConstraints = { ...toolArgumentConstraints, apps_power: { ...toolArgumentConstraints?.apps_power, action: prior ? actions.filter((action) => prior.includes(action)) : actions } };
    }
  }
  return liveCapabilityContext({ ...context, allowedTools, toolArgumentConstraints, scope: scopeRank(context.scope) < scopeRank(ceiling) ? context.scope : ceiling });
}

export function requireWorkflowScope(context: CapabilityRunContext, required: Scope): void {
  if (!allows(context.scope, required)) throw new Error(`workflow requires ${required} authority`);
}

/** Receipt ownership survives demotion; access to its original authority does not. */
export async function requireWorkflowReceiptAuthority(principal: string, run: WorkflowGraphRun, scope: Scope = "exec"): Promise<void> {
  let ceiling = configuredCapabilityCeiling();
  if (principal.startsWith("web:")) {
    const device = await getApprovedDevice(principal.slice(4));
    if (!device) throw new Error("workflow receipt device is revoked");
    if (!roleAtLeast(device.role, run.executionRole ?? "owner")) throw new Error("workflow receipt requires its original execution authority");
    const roleScope: Scope = device.role === "owner" ? "exec" : device.role === "operator" ? "write" : "read";
    if (scopeRank(roleScope) < scopeRank(ceiling)) ceiling = roleScope;
  }
  const effective = scopeRank(scope) < scopeRank(ceiling) ? scope : ceiling;
  if (!allows(effective, run.executionScope ?? "exec")) throw new Error("workflow receipt requires its original execution authority");
}

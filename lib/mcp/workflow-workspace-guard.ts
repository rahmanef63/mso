import type { CapabilityRunContext } from "@/lib/capabilities/tool";
import { activeWorkflowForActor } from "@/lib/workflow";
import os from "node:os";
import path from "node:path";

function absolute(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(value);
}

function inside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function isolatedWorkspace(context: CapabilityRunContext) {
  const actor = context.workflowActor ?? context.actor;
  if (!actor || !context.workflowId) return null;
  const workflow = await activeWorkflowForActor(actor, context.workflowId);
  if (!workflow?.orchestration || workflow.orchestration.isolation !== "isolated-worktree") return null;
  const project = workflow.project ? absolute(workflow.project) : null;
  const workspace = workflow.orchestration.workspacePath ? absolute(workflow.orchestration.workspacePath) : null;
  if (!project || !workspace) throw new Error("isolated source workflow has no verified workspace; cancel/restart it before mutation");
  return { project, workspace, workflowId: workflow.id };
}

/** Mutating filesystem tools are workspace-bound once workflow_start selected
 * isolated source work. The guard is deliberately stricter than the generic FS
 * jail: source tasks do not get to write elsewhere on the host just because an
 * Owner token technically could. */
export async function requireWorkflowMutationPath(context: CapabilityRunContext, rawPath: string): Promise<void> {
  const isolated = await isolatedWorkspace(context);
  if (!isolated || isolated.workspace === isolated.project) return;
  const target = absolute(rawPath);
  if (!inside(isolated.workspace, target)) {
    throw new Error(`workflow ${isolated.workflowId} is source-isolated; mutate only inside ${isolated.workspace}`);
  }
}

/** Shell is the widest authority surface. During isolated source work it must
 * have an explicit cwd inside the task worktree; host/production commands belong
 * in a separate reviewed workflow. */
export async function requireWorkflowExecCwd(context: CapabilityRunContext, rawCwd?: string): Promise<void> {
  const isolated = await isolatedWorkspace(context);
  if (!isolated || isolated.workspace === isolated.project) return;
  if (!rawCwd) throw new Error(`workflow ${isolated.workflowId} is source-isolated; exec requires cwd inside ${isolated.workspace}`);
  const cwd = absolute(rawCwd);
  if (!inside(isolated.workspace, cwd)) {
    throw new Error(`workflow ${isolated.workflowId} is source-isolated; exec cwd must stay inside ${isolated.workspace}`);
  }
}

export async function requireWorkflowProjectTarget(context: CapabilityRunContext, projectPath: string): Promise<void> {
  const isolated = await isolatedWorkspace(context);
  if (!isolated || isolated.workspace === isolated.project) return;
  if (!inside(isolated.workspace, absolute(projectPath))) {
    throw new Error(`workflow ${isolated.workflowId} is source-isolated; project execution must target ${isolated.workspace}`);
  }
}

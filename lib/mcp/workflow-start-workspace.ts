import { discardPreparedProjectWorktree, prepareProjectWorktree, type PreparedProjectWorktree } from "@/lib/host/project-worktree";
import { startWorkflow } from "@/lib/workflow";
import type { TaskClassification } from "@/lib/orchestration/types";

export async function prepareWorkflowStartWorkspace(
  projectPath: string | undefined,
  gitAvailable: boolean | undefined,
  isolation: TaskClassification["isolation"],
): Promise<PreparedProjectWorktree | undefined> {
  return projectPath && gitAvailable && isolation === "isolated-worktree"
    ? prepareProjectWorktree(projectPath)
    : undefined;
}

export function workflowWorkspaceResources(resources: string[], workspace?: PreparedProjectWorktree): string[] {
  return [...new Set([...resources, ...(workspace?.created ? [workspace.workspacePath] : [])])].slice(0, 40);
}

export async function startWorkflowWithWorkspace(
  input: Parameters<typeof startWorkflow>[0],
  workspace?: PreparedProjectWorktree,
) {
  try {
    return await startWorkflow(input);
  } catch (error) {
    if (workspace?.created) await discardPreparedProjectWorktree(workspace).catch(() => false);
    throw error;
  }
}

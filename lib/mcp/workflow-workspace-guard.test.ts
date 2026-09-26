import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWorkflowStoreCache, startWorkflow } from "@/lib/workflow";
import { requireWorkflowExecCwd, requireWorkflowMutationPath } from "./workflow-workspace-guard";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs(); resetWorkflowStoreCache();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function isolatedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workspace-guard-")); roots.push(root);
  const project = path.join(root, "project"), workspace = path.join(root, "worktree");
  await fs.mkdir(project); await fs.mkdir(workspace);
  vi.stubEnv("OS_SKILL_MEMORY_STORE", path.join(root, "workflow.json")); resetWorkflowStoreCache();
  const started = await startWorkflow({
    actor: "mcp:test", scope: "exec", intent: "implement source change", project,
    orchestration: {
      risk: "medium", complexity: "medium", contention: "none", memoryRelevance: "medium",
      isolation: "isolated-worktree", verification: "affected", reasons: [], sharedResourceWarnings: [],
      changedPaths: [], affectedPaths: [], reservedResources: [workspace], overlappingPaths: [], overlappingResources: [],
      activeProjectWorkflows: 0, conflictingWorkflowCount: 0, memoryHits: 0, contextEstimateTokens: 0,
      cleanupState: "pending", workspacePath: workspace, createdAt: new Date().toISOString(),
    },
  });
  return { root, project, workspace, context: { actor: "mcp:test", workflowActor: "mcp:test", workflowId: started.workflow.id, scope: "exec" as const } };
}

describe("workflow source workspace guard", () => {
  it("allows mutation in the task worktree and rejects canonical/host writes", async () => {
    const { project, workspace, context } = await isolatedFixture();
    await expect(requireWorkflowMutationPath(context, path.join(workspace, "src/a.ts"))).resolves.toBeUndefined();
    await expect(requireWorkflowMutationPath(context, path.join(project, "src/a.ts"))).rejects.toThrow(/source-isolated/i);
    await expect(requireWorkflowMutationPath(context, path.join(os.homedir(), "outside.txt"))).rejects.toThrow(/source-isolated/i);
  });

  it("requires shell cwd to be explicit and inside the task worktree", async () => {
    const { project, workspace, context } = await isolatedFixture();
    await expect(requireWorkflowExecCwd(context, workspace)).resolves.toBeUndefined();
    await expect(requireWorkflowExecCwd(context)).rejects.toThrow(/exec requires cwd/i);
    await expect(requireWorkflowExecCwd(context, project)).rejects.toThrow(/exec cwd/i);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-replay-candidate-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const memory = await import("./index");

describe("bounded replay and workflow candidate reuse", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    memory.resetWorkflowStoreCache();
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("extracts only durable replay handles and never result bodies", () => {
    const sha256 = "a".repeat(64);
    const handles = memory.replayHandlesFromResult({
      path: "/repo/lib/a.ts",
      sha256,
      content: "token=raw-secret must-not-persist",
      job_id: "job_123",
      artifact_id: "artifact_123",
      nextCursor: "cursor_123",
      truncated: true,
    });
    expect(handles).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "file", path: "/repo/lib/a.ts", sha256, truncated: true, rereadWith: "read_pipeline" }),
      expect.objectContaining({ kind: "job", jobId: "job_123", rereadWith: "exec_job_status" }),
      expect.objectContaining({ kind: "artifact", artifactId: "artifact_123", rereadWith: "session_artifacts" }),
    ]));
    expect(JSON.stringify(handles)).not.toContain("raw-secret");
    expect(handles.length).toBeLessThanOrEqual(6);

    const hashedPath = `/repo/cache/${"f".repeat(64)}.json`;
    const exact = memory.replayHandlesFromResult({ path: hashedPath, sha256 });
    const startedPath = memory.startWorkflow({
      actor: "mcp:path-hash", scope: "read", intent: "retain content addressed path", project: "/repo",
    });
    expect(exact[0]).toMatchObject({ path: hashedPath });
    return startedPath.then(async ({ workflow }) => {
      await memory.recordWorkflowStep("mcp:path-hash", workflow.id, {
        id: "hash-read", tool: "fs_read", state: "completed", args: { path: hashedPath }, replay: exact,
        ts: new Date().toISOString(),
      });
      const active = await memory.activeWorkflowForActor("mcp:path-hash", workflow.id);
      expect(active?.steps[0]?.replay?.[0]?.path).toBe(hashedPath);
      await memory.cancelWorkflow({ actor: "mcp:path-hash", workflowId: workflow.id });
    });
  });

  it("does not let a failed run poison a previously successful reusable pool", async () => {
    const good = await memory.startWorkflow({
      actor: "mcp:pool-quality", scope: "write", intent: "update bounded replay", project: "/repo",
      candidatePool: { version: 1, paths: ["lib/good.ts"], skillIds: [], connectionIds: [], mcpAliases: [] },
    });
    const first = await memory.finishWorkflow({
      actor: "mcp:pool-quality", workflowId: good.workflow.id, summary: "verified", success: true,
    });
    expect(first.recipe.candidatePool?.paths).toEqual(["lib/good.ts"]);

    const failed = await memory.startWorkflow({
      actor: "mcp:pool-quality", scope: "write", intent: "update bounded replay", project: "/repo",
      candidatePool: { version: 1, paths: ["lib/bad-attempt.ts"], skillIds: [], connectionIds: [], mcpAliases: [] },
    });
    const second = await memory.finishWorkflow({
      actor: "mcp:pool-quality", workflowId: failed.workflow.id, summary: "failed verification", success: false,
    });
    expect(second.recipe.candidatePool?.paths).toEqual(["lib/good.ts"]);
    expect(JSON.stringify(second.recipe.candidatePool)).not.toContain("bad-attempt");
  });

  it("persists a bounded redacted candidate pool with a recipe and reuses it only for the same owner/scope/project", async () => {
    const started = await memory.startWorkflow({
      actor: "mcp:owner-a",
      scope: "exec",
      intent: "update workflow replay handling",
      project: "/repo",
      candidatePool: {
        version: 1,
        revision: "rev-1",
        paths: ["lib/workflow/start.ts"],
        skillIds: ["mso-repo-work"],
        connectionIds: [],
        mcpAliases: [],
      },
    });
    await memory.recordWorkflowStep("mcp:owner-a", started.workflow.id, {
      id: "read",
      tool: "fs_read",
      state: "completed",
      target: "/repo/lib/workflow/replay.ts",
      args: { path: "/repo/lib/workflow/replay.ts" },
      replay: [{
        kind: "file",
        path: "/repo/lib/workflow/replay.ts",
        sha256: "b".repeat(64),
        rereadWith: "read_pipeline",
      }],
      ts: new Date().toISOString(),
    });
    await memory.recordWorkflowStep("mcp:owner-a", started.workflow.id, {
      id: "skill",
      tool: "skills_read",
      state: "completed",
      args: { name: "mso-mcp-feature-engineering" },
      ts: new Date().toISOString(),
    });
    await memory.recordWorkflowStep("mcp:owner-a", started.workflow.id, {
      id: "mcp",
      tool: "project_mcp_tools",
      state: "completed",
      args: { project: "mso", server: "si-coder" },
      ts: new Date().toISOString(),
    });
    await memory.recordWorkflowStep("mcp:owner-a", started.workflow.id, {
      id: "connection",
      tool: "integration_query",
      state: "completed",
      args: { connection: "github-main", provider: "github", token: "must-not-persist" },
      ts: new Date().toISOString(),
    });

    const done = await memory.finishWorkflow({
      actor: "mcp:owner-a",
      workflowId: started.workflow.id,
      summary: "verified",
      success: true,
    });
    expect(done.recipe.candidatePool).toMatchObject({
      version: 1,
      paths: expect.arrayContaining(["lib/workflow/start.ts", "lib/workflow/replay.ts"]),
      skillIds: expect.arrayContaining(["mso-repo-work", "mso-mcp-feature-engineering"]),
      connectionIds: ["github-main"],
      mcpAliases: ["si-coder"],
    });
    expect(JSON.stringify(done.recipe)).not.toContain("must-not-persist");

    const same = await memory.findReusableRecipe({
      actor: "mcp:owner-a", scope: "exec", intent: "update workflow replay handling", project: "/repo",
    });
    expect(same?.id).toBe(done.recipe.id);
    await expect(memory.findReusableRecipe({
      actor: "mcp:owner-b", scope: "exec", intent: "update workflow replay handling", project: "/repo",
    })).resolves.toBeUndefined();
    await expect(memory.findReusableRecipe({
      actor: "mcp:owner-a", scope: "read", intent: "update workflow replay handling", project: "/repo",
    })).resolves.toBeUndefined();
    await expect(memory.findReusableRecipe({
      actor: "mcp:owner-a", scope: "exec", intent: "update workflow replay handling", project: "/other",
    })).resolves.toBeUndefined();
  });
});

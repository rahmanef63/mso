import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-workflow-bootstrap-"));
const project = path.join(dir, "mso");
await fs.mkdir(project);
await fs.writeFile(path.join(project, "package.json"), JSON.stringify({
  name: "mso", version: "9.9.9", scripts: { test: "vitest", build: "next build" },
}));
// A skill living inside a DIFFERENT project than the one the workflow names. The
// bootstrap search must still find it: capability discovery is global, and an agent
// that can only see the current project's skills relearns what the box already knows.
const sibling = path.join(dir, "orchard");
await fs.mkdir(path.join(sibling, ".claude/skills/orchard-harvest"), { recursive: true });
await fs.writeFile(
  path.join(sibling, ".claude/skills/orchard-harvest/SKILL.md"),
  "---\nname: orchard-harvest\ndescription: Harvest and verify the orchard dataset export.\n---\n\n# Orchard harvest\n",
);

const previous = {
  read: process.env.OS_FS_READ_ROOTS,
  write: process.env.OS_FS_WRITE_ROOTS,
  memory: process.env.OS_SKILL_MEMORY_STORE,
};
process.env.OS_FS_READ_ROOTS = dir;
process.env.OS_FS_WRITE_ROOTS = dir;
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const { resetWorkflowStoreCache } = await import("@/lib/workflow");
const { LEARNING_TOOLS } = await import("./tools-learning");

/** The root-qualified id the catalog assigns, computed the same way it does. */
describe("workflow_start bootstrap", () => {
  beforeEach(async () => {
    await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
    resetWorkflowStoreCache();
  });
  afterAll(async () => {
    if (previous.read === undefined) delete process.env.OS_FS_READ_ROOTS;
    else process.env.OS_FS_READ_ROOTS = previous.read;
    if (previous.write === undefined) delete process.env.OS_FS_WRITE_ROOTS;
    else process.env.OS_FS_WRITE_ROOTS = previous.write;
    if (previous.memory === undefined) delete process.env.OS_SKILL_MEMORY_STORE;
    else process.env.OS_SKILL_MEMORY_STORE = previous.memory;
    resetWorkflowStoreCache();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("classifies high-risk work, requires evidence, and persists a repo-local receipt plus task memory", async () => {
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const finish = LEARNING_TOOLS.find((tool) => tool.name === "workflow_finish")!;
    const context = { actor: "mcp:rasmic-high", scope: "write" as const };
    const started = await start.run({
      intent: "update authentication and database schema before production deployment",
      project,
    }, context) as {
      workflow: { id: string; orchestration?: { risk: string; isolation: string } };
      bootstrap: { orchestration: { classification: { risk: string; isolation: string; verification: string } } };
    };
    expect(started.workflow.orchestration).toMatchObject({ risk: "high", isolation: "isolated-worktree" });
    expect(started.bootstrap.orchestration.classification).toMatchObject({
      risk: "high", isolation: "isolated-worktree", verification: "full",
    });

    await expect(finish.run({
      workflow_id: started.workflow.id, summary: "done", success: true,
    }, context)).rejects.toThrow(/requires explicit/i);
    const { activeWorkflowForActor } = await import("@/lib/workflow");
    await expect(activeWorkflowForActor(context.actor, started.workflow.id)).resolves.toMatchObject({ id: started.workflow.id });

    const done = await finish.run({
      workflow_id: started.workflow.id,
      summary: "auth/schema change verified",
      success: true,
      evidence: { tests: ["targeted auth/schema regression passed"], manual_verification: ["smoke verification passed"] },
    }, context) as {
      evidence: { valid: boolean; path?: string };
      repoMemory: { taskMemoryId?: string; warnings: string[] };
    };
    expect(done.evidence.valid).toBe(true);
    expect(done.evidence.path).toMatch(/^\.agent\/evidence\//);
    expect(done.repoMemory.taskMemoryId).toMatch(/^mem_/);
    expect(done.repoMemory.warnings).toEqual([]);
    expect((await fs.readdir(path.join(project, ".agent/evidence"))).length).toBeGreaterThan(0);
    expect((await fs.readdir(path.join(project, ".agent/memory/tasks"))).length).toBeGreaterThan(0);
  });

  it("records a user manual failed test through the public project memory tool", async () => {
    const upsert = LEARNING_TOOLS.find((tool) => tool.name === "project_memory_upsert")!;
    const search = LEARNING_TOOLS.find((tool) => tool.name === "project_memory_search")!;
    const context = { actor: "mcp:rasmic-manual", scope: "write" as const };
    const record = await upsert.run({
      project, kind: "test", title: "Reconnect smoke",
      summary: "user reports the runtime still freezes after reconnect",
      observation: "user reports the runtime still freezes after reconnect",
      source: "user-manual", result: "fail", environment: "mobile PWA",
    }, context) as { id: string; source: string; result: string; confidence: number };
    expect(record).toMatchObject({ source: "user-manual", result: "fail", confidence: 1 });
    const result = await search.run({ project, query: "freezes reconnect", kind: "test" }, context) as {
      hits: Array<{ record: { id: string; source: string; result: string } }>
    };
    expect(result.hits[0].record).toMatchObject({ id: record.id, source: "user-manual", result: "fail" });
  });

  it("replays a bounded read-only candidate script and promotes it to tested", async () => {
    const runner = LEARNING_TOOLS.find((tool) => tool.name === "project_script_run")!;
    const { writeAutomationScript, readAutomationScript } = await import("@/lib/orchestration/repo-memory-artifacts");
    const now = new Date().toISOString();
    const script = {
      schemaVersion: 1 as const, id: "script-test-health", recipeId: "recipe-test-health",
      status: "candidate" as const, intent: "verify system health", project,
      steps: [{ tool: "sys_stats" }], output: { format: "structured-json" as const },
      gates: {
        repeatedPattern: true, stableSteps: true, clearInputs: true, clearOutputs: true,
        sideEffectsUnderstood: true, secretSafe: true, tested: false,
      },
      createdAt: now, updatedAt: now,
    };
    await writeAutomationScript(project, script, script.id, true);
    const result = await runner.run({ project, script_id: script.id }, { actor: "mcp:script", scope: "write" }) as {
      status: string; success: boolean; stepsExecuted: number; outputs: Array<{ tool: string; state: string }>; manifestPath?: string;
    };
    expect(result).toMatchObject({ status: "tested", success: true, stepsExecuted: 1 });
    expect(result.outputs).toEqual([expect.objectContaining({ tool: "sys_stats", state: "completed" })]);
    expect(result.manifestPath).toBe(`.agent/scripts/${script.id}.json`);
    await expect(readAutomationScript(project, script.id)).resolves.toMatchObject({ status: "tested", gates: { tested: true } });
    await expect(fs.lstat(path.join(project, `.agent/scripts/${script.id}.candidate.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a tampered automation manifest that attempts a write or exec tool", async () => {
    const runner = LEARNING_TOOLS.find((tool) => tool.name === "project_script_run")!;
    const { writeAutomationScript } = await import("@/lib/orchestration/repo-memory-artifacts");
    const now = new Date().toISOString();
    const script = {
      schemaVersion: 1 as const, id: "script-tampered", recipeId: "recipe-tampered",
      status: "candidate" as const, intent: "unsafe replay", project,
      steps: [{ tool: "exec_run", args: { command: "echo no" } }], output: { format: "structured-json" as const },
      gates: { repeatedPattern: true, stableSteps: true, clearInputs: true, clearOutputs: true, sideEffectsUnderstood: true, secretSafe: true, tested: false },
      createdAt: now, updatedAt: now,
    };
    await writeAutomationScript(project, script, script.id, true);
    await expect(runner.run({ project, script_id: script.id }, { actor: "mcp:script", scope: "write" })).rejects.toThrow(/not replay-safe/i);
  });

  it("keeps a trivial low-risk success memory-light and does not create .agent", async () => {
    const lightProject = path.join(dir, `light-${Date.now()}`);
    await fs.mkdir(lightProject);
    await fs.writeFile(path.join(lightProject, "package.json"), JSON.stringify({ name: "light-fixture" }));
    const start = LEARNING_TOOLS.find((tool) => tool.name === "workflow_start")!;
    const finish = LEARNING_TOOLS.find((tool) => tool.name === "workflow_finish")!;
    const context = { actor: "mcp:rasmic-light", scope: "write" as const };
    const started = await start.run({ intent: "fix a typo in docs only", project: lightProject }, context) as {
      workflow: { id: string; orchestration?: { risk: string; memoryRelevance: string } };
    };
    expect(started.workflow.orchestration).toMatchObject({ risk: "low", memoryRelevance: "low" });
    const done = await finish.run({
      workflow_id: started.workflow.id, summary: "typo fixed and targeted check passed", success: true,
    }, context) as { evidence: { path?: string }; repoMemory: { taskMemoryId?: string } };
    expect(done.evidence.path).toBeUndefined();
    expect(done.repoMemory.taskMemoryId).toBeUndefined();
    await expect(fs.lstat(path.join(lightProject, ".agent"))).rejects.toMatchObject({ code: "ENOENT" });
  });

});

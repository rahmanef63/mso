import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mso-skill-quality-"));
process.env.OS_SKILL_MEMORY_STORE = path.join(dir, "memory.json");
const memory = await import("./index");

describe("learned workflow quality telemetry", () => {
  beforeEach(async () => { await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true }); memory.resetWorkflowStoreCache(); });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it("tracks retries, invalid args, failures, denials, rollback signals and latency", async () => {
    const started = await memory.startWorkflow({ actor: "mcp:quality", intent: "recover a failed deployment with a verified restore" });
    const now = new Date().toISOString();
    await memory.recordWorkflowStep("mcp:quality", started.workflow.id, { id: "bad-args", tool: "exec_run", state: "invalid_args", target: "bun", ts: now });
    await memory.recordWorkflowStep("mcp:quality", started.workflow.id, { id: "failed", tool: "exec_run", state: "failed", target: "bun", durationMs: 30, ts: now });
    await memory.recordWorkflowStep("mcp:quality", started.workflow.id, { id: "retry", tool: "exec_run", state: "completed", target: "bun", durationMs: 20, ts: now });
    await memory.recordWorkflowStep("mcp:quality", started.workflow.id, { id: "restore", tool: "exec_run", state: "completed", target: "restore backup", durationMs: 10, ts: now });
    await memory.recordWorkflowStep("mcp:quality", started.workflow.id, { id: "denied", tool: "fs_write", state: "denied", target: "/srv/app", ts: now });
    const done = await memory.finishWorkflow({ actor: "mcp:quality", workflowId: started.workflow.id, summary: "restored and verified", success: true });
    expect(done.recipe.qualityVersion).toBe(1);
    expect(done.recipe.lastQuality).toMatchObject({
      stepAttempts: 5, completedSteps: 2, failedSteps: 1, deniedSteps: 1, invalidArgSteps: 1,
      retries: 2, rollbackSignals: 1, timedSteps: 3, totalStepDurationMs: 60, averageStepDurationMs: 20,
    });
    expect(done.recipe.quality).toEqual(done.recipe.lastQuality);
  });
});

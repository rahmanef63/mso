import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(os.tmpdir(), `mso-session-flow-${process.pid}.json`);
process.env.OS_SKILL_MEMORY_STORE = file;
const memory = await import("@/lib/skills/memory");
const { searchSkillMemory } = await import("@/lib/skills/search");
const { recipeActor, workflowActor } = await import("./dispatch-actors");

beforeEach(async () => {
  await fs.rm(file, { force: true });
  memory.resetSkillMemoryCache();
});
afterAll(async () => {
  await fs.rm(file, { force: true });
  delete process.env.OS_SKILL_MEMORY_STORE;
  memory.resetSkillMemoryCache();
});

describe("conversation-scoped workflow ownership", () => {
  it("isolates active runs but shares verified recipes at the stable client principal", async () => {
    const auditActor = "mcp:same-token";
    const principal = "mcp-client:shared-client";
    const aContext = { principal, sessionId: "20260901_120000_aaaaaaaa" };
    const bContext = { principal, sessionId: "20260901_120001_bbbbbbbb" };
    const aOwner = workflowActor(auditActor, aContext)!;
    const bOwner = workflowActor(auditActor, bContext)!;
    const learnedOwnerA = recipeActor(auditActor, aContext)!;
    const learnedOwnerB = recipeActor(auditActor, bContext)!;
    const intent = "verify the repeated session-scoped deployment recipe";

    expect(aOwner).not.toBe(bOwner);
    expect(learnedOwnerA).toBe(principal);
    expect(learnedOwnerB).toBe(principal);

    const started = await memory.startWorkflow({ actor: aOwner, scope: "write", intent });
    expect(await memory.activeWorkflowForActor(bOwner, started.workflow.id)).toBeNull();
    await expect(memory.finishWorkflow({
      actor: bOwner, workflowId: started.workflow.id, summary: "must not cross sessions", success: true,
      recipeActor: learnedOwnerB,
    })).rejects.toThrow("workflow_id was not found for this MSO session");

    await memory.recordWorkflowStep(aOwner, started.workflow.id, {
      id: "step-1", tool: "sys_stats", state: "completed", ts: new Date().toISOString(),
    });
    await memory.finishWorkflow({
      actor: aOwner, workflowId: started.workflow.id, summary: "verified in session A", success: true,
      recipeActor: learnedOwnerA,
    });

    const search = await searchSkillMemory(intent, {
      recipeAccess: { actor: learnedOwnerB, scope: "write" },
      projects: [],
    });
    expect(search.hits).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "recipe", source: "learned" }),
    ]));
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const file = path.join(os.tmpdir(), "mso-workflow-recovery-" + process.pid + ".json");
process.env.OS_SKILL_MEMORY_STORE = file;

const workflow = await import("./index");

beforeEach(async () => {
  await fs.rm(file, { force: true });
  await fs.rm(file + ".active.json", { force: true });
  workflow.resetWorkflowStoreCache();
});

afterAll(async () => {
  await fs.rm(file, { force: true });
  await fs.rm(file + ".active.json", { force: true });
  delete process.env.OS_SKILL_MEMORY_STORE;
  workflow.resetWorkflowStoreCache();
});

describe("workflow crash recovery", () => {
  it("finds unfinished project work across sessions without exposing the old workflow id", async () => {
    const principal = "mcp-client:recover";
    const a = principal + "#session:session-a";
    const b = principal + "#session:session-b";
    const other = principal + "#session:session-c";

    const first = await workflow.startWorkflow({
      actor: a,
      scope: "write",
      intent: "continue MSO session recovery",
      project: "/home/rahman/projects/mso",
      constraints: "preserve session isolation",
    });
    await workflow.recordWorkflowStep(a, first.workflow.id, {
      id: "a-1",
      tool: "fs_read",
      state: "completed",
      ts: "2026-09-26T08:00:00.000Z",
    });

    const latest = await workflow.startWorkflow({
      actor: b,
      scope: "write",
      intent: "finish MSO crash-safe continuation",
      project: "/home/rahman/projects/mso",
    });
    await workflow.recordWorkflowStep(b, latest.workflow.id, {
      id: "b-1",
      tool: "fs_write",
      state: "completed",
      ts: "2026-09-26T08:10:00.000Z",
    });

    await workflow.startWorkflow({
      actor: other,
      scope: "write",
      intent: "unrelated Batonly work",
      project: "/home/rahman/projects/baton",
    });

    const rows = await workflow.workflowRecoveryCandidates({
      principal,
      projectRefs: ["mso"],
      excludeSessionId: "session-a",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceSessionId: "session-b",
      intent: "finish MSO crash-safe continuation",
      project: "/home/rahman/projects/mso",
      stepCount: 1,
    });
    expect(JSON.stringify(rows[0])).not.toContain(latest.workflow.id);
    expect(JSON.stringify(rows)).not.toContain("unrelated Batonly work");
  });
});

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

const root = mkdtempSync(path.join(os.tmpdir(), "mso-standby-workflow-lifecycle-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_LOCAL_AGENT_STANDBY_STORE = path.join(root, "standby.json");
process.env.OS_SKILL_MEMORY_STORE = path.join(root, "workflow.json");
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const workflow = await import("@/lib/workflow");
const sessions = await import("@/lib/agent/session-store");
const standbyStore = await import("@/lib/agent/local-agent-standby-store");
const { WORKFLOW_LIFECYCLE_TOOLS } = await import("./tools-workflow-lifecycle");

const actor = "mcp:standby-lifecycle";
const principal = "mcp-client:standby-lifecycle";
const tools = new Map(WORKFLOW_LIFECYCLE_TOOLS.map((tool) => [tool.name, tool]));

async function armedWorkflow(intent: string) {
  const started = await workflow.startWorkflow({ actor, scope: "write", intent });
  const session = await sessions.createAgentSession(principal, "mcp");
  await standbyStore.armLocalAgentStandbyRecord({
    principal,
    sessionId: session.id,
    workflowActor: actor,
    workflowId: started.workflow.id,
  });
  return { session, workflow: started.workflow };
}

beforeEach(() => {
  workflow.resetWorkflowStoreCache();
});

afterAll(() => {
  workflow.resetWorkflowStoreCache();
  rmSync(root, { recursive: true, force: true });
});

describe("workflow lifecycle disarms durable local-agent standby", () => {
  it("workflow_cancel disarms the exact matching standby record", async () => {
    const started = await armedWorkflow("cancel standby integration");
    await tools.get("workflow_cancel")!.run(
      { workflow_id: started.workflow.id, reason: "test cancel" },
      { actor, workflowActor: actor, scope: "write" },
    );
    const record = await standbyStore.getLocalAgentStandbyRecord(principal, started.session.id);
    expect(record).toMatchObject({ workflowId: started.workflow.id, armed: false });
    expect(await workflow.activeWorkflowForActor(actor, started.workflow.id)).toBeNull();
  });

  it("workflow_finish disarms the exact matching standby record", async () => {
    const started = await armedWorkflow("finish standby integration");
    await tools.get("workflow_finish")!.run(
      { workflow_id: started.workflow.id, summary: "verified", success: true },
      { actor, workflowActor: actor, scope: "write" },
    );
    const record = await standbyStore.getLocalAgentStandbyRecord(principal, started.session.id);
    expect(record).toMatchObject({ workflowId: started.workflow.id, armed: false });
    expect(await workflow.activeWorkflowForActor(actor, started.workflow.id)).toBeNull();
  });
});

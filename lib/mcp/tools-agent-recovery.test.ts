import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-tools-agent-recovery-"));
process.env.OS_AGENT_MEMORY_DIR = root;
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_SKILL_MEMORY_STORE = path.join(root, "skill-memory.json");
vi.resetModules();

const { AGENT_TOOLS } = await import("./tools-agent");
const sessions = await import("@/lib/agent/session-store");
const workflow = await import("@/lib/workflow");

function tool(name: string) {
  const found = AGENT_TOOLS.find((row) => row.name === name);
  if (!found) throw new Error("missing tool " + name);
  return found;
}

beforeEach(async () => {
  await fs.rm(process.env.OS_SKILL_MEMORY_STORE!, { force: true });
  await fs.rm(process.env.OS_SKILL_MEMORY_STORE! + ".active.json", { force: true });
  workflow.resetWorkflowStoreCache();
});

afterAll(async () => {
  delete process.env.OS_AGENT_MEMORY_DIR;
  delete process.env.OS_AGENT_SESSIONS_DIR;
  delete process.env.OS_SKILL_MEMORY_STORE;
  workflow.resetWorkflowStoreCache();
  await fs.rm(root, { recursive: true, force: true });
});

describe("MCP crash-safe session continuation", () => {
  it("auto-selects the unfinished prior session and returns a fresh-workflow recipe without requiring a session ref", async () => {
    const principal = "mcp-client:crash-recovery";
    const prior = await sessions.createAgentSession(principal, "mcp", { title: "MSO recovery implementation" });
    const active = await workflow.startWorkflow({
      actor: principal + "#session:" + prior.id,
      scope: "write",
      intent: "implement crash-safe continuation",
      project: "/home/rahman/projects/mso",
      constraints: "do not reuse dead session workflow ids",
    });
    await workflow.recordWorkflowStep(principal + "#session:" + prior.id, active.workflow.id, {
      id: "step-1",
      tool: "fs_write",
      state: "completed",
      ts: "2026-09-26T08:10:00.000Z",
    });

    const current = await sessions.createAgentSession(principal, "mcp", { title: "Fresh ChatGPT conversation" });
    const result = await tool("agent_session_resume").run({}, {
      principal,
      sessionId: current.id,
      scope: "read" as const,
    }) as {
      session: { id: string; title: string };
      continuation: {
        source: string;
        workflow: { intent: string; project: string; stepCount: number };
        workflowStart: { intent: string; project: string; constraints: string };
        instruction: string;
      };
    };

    expect(result.session.id).toBe(prior.id);
    expect(result.continuation).toMatchObject({
      source: "unfinished_workflow",
      workflow: {
        intent: "implement crash-safe continuation",
        project: "/home/rahman/projects/mso",
        stepCount: 1,
      },
      workflowStart: {
        intent: "implement crash-safe continuation",
        project: "/home/rahman/projects/mso",
        constraints: "do not reuse dead session workflow ids",
      },
    });
    expect(result.continuation.instruction).toMatch(/Do not reuse the old workflow_id/);
    expect(JSON.stringify(result.continuation)).not.toContain(active.workflow.id);
  });

  it("returns safe candidate labels instead of guessing when several unfinished sessions are recoverable", async () => {
    const principal = "mcp-client:ambiguous-recovery";
    const first = await sessions.createAgentSession(principal, "mcp", { title: "Batonly UI pass" });
    const second = await sessions.createAgentSession(principal, "mcp", { title: "BelajarAI staging" });
    const current = await sessions.createAgentSession(principal, "mcp", { title: "Fresh conversation" });

    const a = await workflow.startWorkflow({
      actor: principal + "#session:" + first.id,
      scope: "write",
      intent: "continue Batonly UI remediation",
      project: "/home/rahman/projects/baton",
    });
    await workflow.recordWorkflowStep(principal + "#session:" + first.id, a.workflow.id, {
      id: "a", tool: "fs_read", state: "completed", ts: "2026-09-26T08:10:00.000Z",
    });
    const b = await workflow.startWorkflow({
      actor: principal + "#session:" + second.id,
      scope: "write",
      intent: "continue BelajarAI staging",
      project: "/home/rahman/projects/belajar-ai",
    });
    await workflow.recordWorkflowStep(principal + "#session:" + second.id, b.workflow.id, {
      id: "b", tool: "fs_read", state: "completed", ts: "2026-09-26T08:11:00.000Z",
    });

    const result = await tool("agent_session_resume").run({}, {
      principal,
      sessionId: current.id,
      scope: "read" as const,
    }) as {
      selectionRequired: boolean;
      candidates: Array<{ sessionRef: string; title: string; intent: string; project?: string }>;
      instruction: string;
    };

    expect(result.selectionRequired).toBe(true);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((row) => row.title).sort()).toEqual(["Batonly UI pass", "BelajarAI staging"]);
    expect(result.candidates.map((row) => row.intent)).toEqual(expect.arrayContaining([
      "continue Batonly UI remediation",
      "continue BelajarAI staging",
    ]));
    expect(result.instruction).toMatch(/Do not ask the user to search MSO for an id/);
    expect(JSON.stringify(result)).not.toContain(a.workflow.id);
    expect(JSON.stringify(result)).not.toContain(b.workflow.id);
  });
});

import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(os.tmpdir(), "mso-a2a-local-session-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_A2A_TASK_STORE = path.join(root, "tasks.json");
process.env.OS_A2A_LOCAL_AUTH_STORE = path.join(root, "local-auth.json");
process.env.OS_A2A_ALLOW_LOOPBACK = "1";
process.env.OS_A2A_LOOPBACK_ORIGIN = "http://127.0.0.1:4555";
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const runner = vi.hoisted(() => vi.fn());
vi.mock("./inbound-agent", () => ({ runInboundA2AAgent: runner }));

const { createAgentSession } = await import("@/lib/agent/session-store");
const {
  handoffA2ALocalSession,
  listA2ALocalSessions,
  resolveA2ALocalSession,
  spawnA2ALocalSubagent,
} = await import("./local-session");

afterAll(() => rmSync(root, { recursive: true, force: true }));

async function bece() {
  return createAgentSession("cli:owner", "cli", {
    title: "bece",
    titleSource: "manual",
    cwd: "/srv/projects/bece",
    memorySnapshot: {
      user: "local user snapshot",
      memory: "local memory snapshot",
      capturedAt: "2026-09-02T00:00:00.000Z",
    },
    contextSummary: "bece compact context",
    history: [{ role: "user", text: "previous bece task" }],
  });
}

describe("same-host A2A durable-session agents", () => {
  it("resolves a session by human name, full id, exact cwd, or cwd basename", async () => {
    const session = await bece();
    expect((await resolveA2ALocalSession("bece")).id).toBe(session.id);
    expect((await resolveA2ALocalSession(session.id)).id).toBe(session.id);
    expect((await resolveA2ALocalSession("/srv/projects/bece")).id).toBe(
      session.id,
    );
    expect((await resolveA2ALocalSession("bece")).cwd).toBe(
      "/srv/projects/bece",
    );
    const listed = await listA2ALocalSessions();
    const row = listed.find((item) => item.id === session.id);
    expect(row?.cardUrl).toBe(
      `http://127.0.0.1:4555/.well-known/agent-card.json?session=${session.id}`,
    );
  });

  it("runs a handoff against the target durable session context", async () => {
    const session = await bece();
    runner.mockImplementationOnce(
      async ({ principal, taskId, session: target }) => {
        expect(principal).toBe(`a2a:local:${session.id}`);
        expect(taskId).toMatch(/^task_/);
        expect(target.id).toBe(session.id);
        expect(target.cwd).toBe("/srv/projects/bece");
        return { text: "bece result", rounds: 1, toolCalls: [] };
      },
    );
    const result = await handoffA2ALocalSession(
      session.id,
      "review local change",
    );
    expect(result.task.status.state).toBe("TASK_STATE_COMPLETED");
    expect(result.task.artifacts[0].parts[0].text).toBe("bece result");
  });

  it("spawns a durable child agent that inherits context/cwd but has its own id", async () => {
    const source = await bece();
    runner.mockImplementationOnce(async ({ session: child, principal }) => {
      expect(child.id).not.toBe(source.id);
      expect(child.parentSessionId).toBe(source.id);
      expect(child.cwd).toBe(source.cwd);
      expect(child.contextSummary).toBe(source.contextSummary);
      expect(principal).toBe(`a2a:local:${child.id}`);
      return { text: "child result", rounds: 1, toolCalls: [] };
    });
    const result = await spawnA2ALocalSubagent({
      ownerPrincipal: "cli:owner",
      sourceSessionRef: source.id,
      objective: "independent review",
      title: "reviewer",
    });
    expect(result.session.title).toBe("reviewer");
    expect(result.session.parentSessionId).toBe(source.id);
    expect(result.task.artifacts[0].parts[0].text).toBe("child result");
  });
});

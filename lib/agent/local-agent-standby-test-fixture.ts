import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export const root = mkdtempSync(path.join(os.tmpdir(), "mso-local-agent-standby-"));
process.env.OS_AGENT_SESSIONS_DIR = path.join(root, "sessions");
process.env.OS_LOCAL_AGENT_PRESENCE_STORE = path.join(root, "presence.json");
process.env.OS_LOCAL_AGENT_MESSAGE_STORE = path.join(root, "messages.json");
process.env.OS_LOCAL_AGENT_STANDBY_STORE = path.join(root, "standby.json");
process.env.OS_A2A_TASK_STORE = path.join(root, "tasks.json");
process.env.OS_LOCAL_AGENT_LEASE_MS = "15000";
process.env.NEXT_PUBLIC_OS_DEMO = "0";

const hoistedMocks = vi.hoisted(() => ({
  active: true,
  handoff: vi.fn(),
}));
export const mocks = hoistedMocks;
vi.mock("@/lib/workflow", () => ({
  activeWorkflowForActor: vi.fn(async (_actor: string, id: string) =>
    mocks.active ? { id, steps: [] } : null),
}));
vi.mock("@/lib/a2a/local-session", () => ({
  handoffOwnerLocalSession: mocks.handoff,
}));

export const store = await import("./session-store");
export const presence = await import("./local-agent-presence");
export const directory = await import("./local-agent-directory");
export const mailbox = await import("./local-agent-mailbox");
export const messaging = await import("./local-agent-messaging");
export const events = await import("./local-agent-events");
export const standbyStore = await import("./local-agent-standby-store");
export const standby = await import("./local-agent-standby");

export const owner = "mcp-client:standby-owner";
export const other = "mcp-client:foreign";
export const workflowActor = "mcp:standby-owner";
export const workflowId = "11111111-1111-4111-8111-111111111111";
export const capabilities = {
  list: () => [],
  invoke: vi.fn(async () => ({ content: [] })),
};

export function completedTask(text = "standby result") {
  return {
    session: { id: "target" },
    task: {
      id: `task_${crypto.randomUUID()}`,
      status: { state: "TASK_STATE_COMPLETED", timestamp: new Date().toISOString() },
      artifacts: [{
        artifactId: "artifact",
        name: "result",
        parts: [{ text, mediaType: "text/plain" }],
      }],
      history: [],
      metadata: { "mso.scope": "exec" },
    },
  };
}

export async function pair() {
  const coordinator = await store.createAgentSession(owner, "mcp");
  const worker = await store.createAgentSession(owner, "mcp");
  await presence.touchLocalAgentPresence(
    owner,
    coordinator.id,
    "idle",
    `test:${coordinator.id}`,
  );
  await presence.touchLocalAgentPresence(owner, worker.id, "idle", `test:${worker.id}`);
  return { coordinator, worker };
}

export async function arm(workerId: string) {
  return standby.armLocalAgentStandby({
    principal: owner,
    sessionId: workerId,
    workflowActor,
    workflowId,
    capabilities,
  });
}

export async function eventually<T>(
  read: () => Promise<T | null | undefined | false>,
  timeoutMs = 2500,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value as T;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for standby test condition");
}

export function resetStandbyMocks(): void {
  mocks.active = true;
  mocks.handoff.mockReset();
  mocks.handoff.mockResolvedValue(completedTask());
}

export function resetStandbyRuntime(): void {
  standby.resetLocalAgentStandbyRuntimeForTest();
}

export function cleanupStandbyFixture(): void {
  rmSync(root, { recursive: true, force: true });
}

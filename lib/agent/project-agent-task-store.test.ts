import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(os.tmpdir(), "mso-project-agent-store-"));
process.env.OS_PROJECT_AGENT_TASKS_DIR = root;
const store = await import("./project-agent-task-store");

afterAll(async () => { delete process.env.OS_PROJECT_AGENT_TASKS_DIR; await rm(root, { recursive: true, force: true }); });

describe("project agent task store", () => {
  it("persists client-owned message status without cross-principal access", async () => {
    const task = await store.createProjectAgentTask({ principal: "client-a", sessionId: "session-a", project: { id: "root/project", name: "project" }, planMode: false, maxScope: "write" });
    expect(task.status).toBe("in_progress");
    expect(await store.getProjectAgentTask("client-b", task.id)).toBeNull();
    const done = await store.updateProjectAgentTask("client-a", task.id, { status: "completed", result: { text: "done", subagentId: "subagent-1", rounds: 2 } });
    expect(done).toMatchObject({ status: "completed", result: { text: "done", rounds: 2 } });
    expect(await store.getProjectAgentTask("client-a", task.id)).toMatchObject({ status: "completed" });
  });

  it("uses private filesystem permissions", async () => {
    const task = await store.createProjectAgentTask({ principal: "client-private", sessionId: "session-private", project: { id: "root/private", name: "private" }, planMode: true, maxScope: "read" });
    const files: string[] = [];
    const walk = async (dir: string) => { for (const entry of await import("node:fs/promises").then((m) => m.readdir(dir, { withFileTypes: true }))) { const target = path.join(dir, entry.name); if (entry.isDirectory()) await walk(target); else files.push(target); } };
    await walk(root);
    const file = files.find((row) => row.endsWith(`${task.id}.json`));
    expect(file).toBeTruthy();
    expect((await stat(file!)).mode & 0o077).toBe(0);
  });
});

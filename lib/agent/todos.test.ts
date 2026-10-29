import { afterAll, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentTodoItem, AgentTodoSummary } from "./todos";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "mso-agent-todos-p0-"));
const sessions = path.join(root, "sessions");
process.env.OS_AGENT_SESSIONS_DIR = sessions;
process.env.OS_AGENT_MEMORY_DIR = path.join(root, "memory");
process.env.OS_AGENT_SESSION_ARCHIVE_DIR = path.join(root, "archives");
process.env.OS_AGENT_SESSION_PRESERVATION_DIR = path.join(root, "preservation");
process.env.OS_AGENT_SESSION_COMPACT_TOKENS = "10000";
process.env.OS_AGENT_SESSION_RECENT_TOKENS = "5000";
process.env.OS_AGENT_SESSION_ARCHIVE_DAYS = "30";

afterAll(async () => {
  for (const k of ["OS_AGENT_SESSIONS_DIR", "OS_AGENT_MEMORY_DIR", "OS_AGENT_SESSION_ARCHIVE_DIR", "OS_AGENT_SESSION_PRESERVATION_DIR", "OS_AGENT_SESSION_COMPACT_TOKENS", "OS_AGENT_SESSION_RECENT_TOKENS", "OS_AGENT_SESSION_ARCHIVE_DAYS"]) delete process.env[k];
  await fs.rm(root, { recursive: true, force: true });
});

vi.resetModules();
const store = await import("./session-store");
const todos = await import("./todos");
const { AGENT_TOOLS } = await import("@/lib/mcp/tools-agent");

describe("todo_write contract and session persistence", () => {
  it("writing a list persists it and a re-read returns the same list", async () => {
    const session = await store.createAgentSession("principal:t1", "cli", { title: "Persist" });
    const items: AgentTodoItem[] = [
      { content: "Read code", status: "completed" },
      { content: "Implement todo tool", status: "in_progress", activeForm: "implementing" },
      { content: "Run tests", status: "pending" },
    ];
    const res = await todos.writeAgentSessionTodos("principal:t1", session.id, items);
    expect(res).toEqual({ ok: true, count: 3, inProgress: "Implement todo tool", completed: 1, pending: 1 });
    const reloaded = await store.getAgentSession("principal:t1", session.id);
    expect((reloaded as any)?.todos).toEqual(items);
    expect(await todos.readAgentSessionTodos("principal:t1", session.id)).toEqual(items);
    const note = reloaded?.events.find((e) => e.kind === "note" && e.detail?.includes("Implement todo tool"));
    expect(note?.detail).toMatch(/Todos: 3 items \(1 completed, in progress: Implement todo tool\)/);
  });

  it("a second write REPLACES rather than appends", async () => {
    const session = await store.createAgentSession("principal:t2", "cli", { title: "Replace" });
    await todos.writeAgentSessionTodos("principal:t2", session.id, [
      { content: "Task 1", status: "pending" },
      { content: "Task 2", status: "pending" },
    ]);
    expect(await todos.readAgentSessionTodos("principal:t2", session.id)).toHaveLength(2);
    const next: AgentTodoItem[] = [{ content: "Replaced task", status: "completed" }];
    await todos.writeAgentSessionTodos("principal:t2", session.id, next);
    const reloaded = await todos.readAgentSessionTodos("principal:t2", session.id);
    expect(reloaded).toEqual(next);
  });

  it("over 50 items is refused", async () => {
    const session = await store.createAgentSession("principal:t3", "cli", { title: "Cap" });
    const tooMany = Array.from({ length: 51 }, (_, i) => ({ content: `T${i}`, status: "pending" as const }));
    await expect(todos.writeAgentSessionTodos("principal:t3", session.id, tooMany)).rejects.toThrow(/cannot exceed 50 items/i);
  });

  it("an invalid status is refused", async () => {
    const session = await store.createAgentSession("principal:t4", "cli", { title: "Invalid status" });
    await expect(todos.writeAgentSessionTodos("principal:t4", session.id, [{ content: "Bad", status: "done" as any }]))
      .rejects.toThrow(/status must be one of/i);
  });

  it("empty content is refused", async () => {
    const session = await store.createAgentSession("principal:t5", "cli", { title: "Empty content" });
    await expect(todos.writeAgentSessionTodos("principal:t5", session.id, [{ content: "", status: "pending" }]))
      .rejects.toThrow(/content cannot be empty/i);
    await expect(todos.writeAgentSessionTodos("principal:t5", session.id, [{ content: "   ", status: "pending" }]))
      .rejects.toThrow(/content cannot be empty/i);
  });

  it("the returned summary counts are correct and inProgress names the single in-progress item (null when none)", async () => {
    const session = await store.createAgentSession("principal:t6", "cli", { title: "Summary" });
    const s1 = await todos.writeAgentSessionTodos("principal:t6", session.id, [
      { content: "C1", status: "completed" },
      { content: "C2", status: "completed" },
      { content: "Active task", status: "in_progress" },
      { content: "P1", status: "pending" },
    ]);
    expect(s1).toEqual({ ok: true, count: 4, inProgress: "Active task", completed: 2, pending: 1 });
    const s2 = await todos.writeAgentSessionTodos("principal:t6", session.id, [
      { content: "C1", status: "completed" },
      { content: "P1", status: "pending" },
    ]);
    expect(s2).toEqual({ ok: true, count: 2, inProgress: null, completed: 1, pending: 1 });
  });

  it("old session records without the field still load", async () => {
    const session = await store.createAgentSession("principal:t7", "cli", { title: "Legacy" });
    const loaded = await store.getAgentSession("principal:t7", session.id);
    expect(loaded).not.toBeNull();
    expect((loaded as any)?.todos).toBeUndefined();
    expect(await todos.readAgentSessionTodos("principal:t7", session.id)).toEqual([]);
    const updated = await todos.writeAgentSessionTodos("principal:t7", session.id, [{ content: "New", status: "pending" }]);
    expect(updated.count).toBe(1);
    expect(await todos.readAgentSessionTodos("principal:t7", session.id)).toHaveLength(1);
  });

  it("tool todo_write respects session scope and writes checklist", async () => {
    const session = await store.createAgentSession("principal:mcp", "mcp", { title: "Tool test" });
    const tool = AGENT_TOOLS.find((row) => row.name === "todo_write");
    expect(tool).toBeDefined();
    await expect(tool!.run({ todos: [{ content: "x", status: "pending" }] }, { principal: "principal:mcp", scope: "write" }))
      .rejects.toThrow(/no conversation-bound MSO session/i);
    await expect(tool!.run({ todos: [{ content: "x", status: "pending" }], session_id: "other" }, { principal: "principal:mcp", sessionId: session.id, scope: "write" }))
      .rejects.toThrow(/session_id must match the active agent session/i);
    const res = (await tool!.run({ todos: [{ content: "Step 1", status: "in_progress" }], session_id: session.id }, { principal: "principal:mcp", sessionId: session.id, scope: "write" })) as AgentTodoSummary;
    expect(res).toEqual({ ok: true, count: 1, inProgress: "Step 1", completed: 0, pending: 0 });
    expect(await todos.readAgentSessionTodos("principal:mcp", session.id)).toEqual([{ content: "Step 1", status: "in_progress" }]);
  });
});

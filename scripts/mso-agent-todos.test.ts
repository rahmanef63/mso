import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTodos,
  formatTodoBlock,
  latestTodos,
  parseTodoCall,
  rememberTodos,
  resetTodosForTesting,
  todoStatusChip,
} from "./mso-agent-todos.mjs";

describe("MSO Agent todos view", () => {
  beforeEach(() => {
    resetTodosForTesting();
  });

  it("1. a full list renders all three states with the right markers and the active item uses activeForm", () => {
    const input = {
      todos: [
        { status: "completed", content: "read plan documentation" },
        { status: "in_progress", content: "write parser", activeForm: "writing parser" },
        { status: "pending", content: "verify tests pass" },
      ],
    };
    const result = JSON.stringify({
      ok: true,
      count: 3,
      inProgress: "writing parser",
      completed: 1,
      pending: 1,
    });

    const parsed = parseTodoCall(input, result);
    expect(parsed).not.toBeNull();

    const output = formatTodoBlock(parsed);
    expect(output).toContain("  [x] read plan documentation");
    expect(output).toContain("  [~] writing parser");
    expect(output).not.toContain("write parser");
    expect(output).toContain("  [ ] verify tests pass");
    expect(output).toContain("  1/3 done");

    const lines = output.split("\n");
    for (const line of lines) {
      expect(line.startsWith("  ")).toBe(true);
    }
  });

  it("2. maxItems is respected and the withheld count is reported", () => {
    const todos = [];
    for (let i = 1; i <= 15; i++) {
      todos.push({
        status: i <= 5 ? "completed" : "pending",
        content: `task item ${i}`,
      });
    }

    const state = {
      items: todos,
      summary: { ok: true, count: 15, completed: 5, pending: 10, inProgress: null },
    };

    const output = formatTodoBlock(state, { maxItems: 12 });
    expect(output).toContain("  … 3 more items");
    expect(output).toContain("  5/15 done");

    const renderedTasks = output.split("\n").filter((l) => l.includes("task item"));
    expect(renderedTasks).toHaveLength(12);
  });

  it("3. an unparseable result and a non-array todos do not throw and yield null or a summary-only state", () => {
    expect(parseTodoCall(null, null)).toBeNull();
    expect(parseTodoCall({}, "corrupt json string {")).toBeNull();
    expect(parseTodoCall({ todos: "not an array" }, "invalid json")).toBeNull();

    const summaryOnly = parseTodoCall(
      { todos: "not an array" },
      JSON.stringify({ ok: true, count: 4, completed: 2, inProgress: null, pending: 2 }),
    );
    expect(summaryOnly).not.toBeNull();
    expect(summaryOnly?.items).toEqual([]);
    expect(summaryOnly?.summary?.count).toBe(4);

    const itemsOnly = parseTodoCall(
      {
        todos: [{ status: "pending", content: "item without valid summary result" }],
      },
      "corrupted { json",
    );
    expect(itemsOnly).not.toBeNull();
    expect(itemsOnly?.items).toHaveLength(1);
    expect(itemsOnly?.summary).toBeNull();
  });

  it("4. items with an invalid status or empty content are dropped, not rendered", () => {
    const input = {
      todos: [
        { status: "unknown_status", content: "invalid status" },
        { status: "pending", content: "" },
        { status: "pending", content: "   " },
        { status: 123, content: "number status" },
        null,
        "string instead of object",
        { status: "completed", content: "valid item" },
      ],
    };

    const parsed = parseTodoCall(input, null);
    expect(parsed).not.toBeNull();
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].content).toBe("valid item");

    const output = formatTodoBlock(parsed);
    expect(output).toContain("  [x] valid item");
    expect(output).not.toContain("invalid status");
  });

  it("5. todoStatusChip() is null before any rememberTodos, and names the active item after", () => {
    expect(latestTodos()).toBeNull();
    expect(todoStatusChip()).toBeNull();

    const state = {
      items: [
        { status: "completed", content: "setup project" },
        { status: "in_progress", content: "write parser", activeForm: "writing the parser" },
        { status: "pending", content: "add status chip" },
      ],
      summary: { ok: true, count: 3, completed: 1, pending: 1, inProgress: "write parser" },
    };

    rememberTodos(state);
    expect(latestTodos()).toBe(state);

    const chip = todoStatusChip();
    expect(chip).toBe("todos 1/3 · writing the parser");
  });

  it("6. rememberTodos replaces the previous list rather than merging", () => {
    const stateA = {
      items: [{ status: "pending", content: "initial task" }],
      summary: { ok: true, count: 1, completed: 0, pending: 1, inProgress: null },
    };
    rememberTodos(stateA);
    expect(latestTodos()?.items[0].content).toBe("initial task");

    const stateB = {
      items: [{ status: "completed", content: "replacement task" }],
      summary: { ok: true, count: 1, completed: 1, pending: 0, inProgress: null },
    };
    rememberTodos(stateB);

    const current = latestTodos();
    expect(current?.items).toHaveLength(1);
    expect(current?.items[0].content).toBe("replacement task");
    expect(formatTodoBlock(current)).not.toContain("initial task");
  });

  it("7. no colours passed means no ANSI codes in the output", () => {
    const state = {
      items: [
        { status: "completed", content: "done task" },
        { status: "in_progress", content: "working task", activeForm: "actively working" },
        { status: "pending", content: "future task" },
      ],
      summary: { ok: true, count: 3, completed: 1, pending: 1, inProgress: "actively working" },
    };

    const outputWithoutColors = formatTodoBlock(state);
    // Escape code regex detects ANSI sequences
    expect(outputWithoutColors).not.toMatch(/\x1b/);

    const outputWithEmptyColors = formatTodoBlock(state, { colors: {} });
    expect(outputWithEmptyColors).not.toMatch(/\x1b/);
  });
});

describe("todo view bounds and session hygiene", () => {
  it("treats a non-finite maxItems as no cap, so --all really shows every item", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ content: `task ${i}`, status: "pending" }));
    const block = formatTodoBlock({ items, summary: null }, { maxItems: Number.POSITIVE_INFINITY });
    expect(block).toContain("task 29");
    expect(block).not.toContain("more items");
  });

  it("drops the cache when a session ends, so a new session does not inherit the checklist", () => {
    rememberTodos(parseTodoCall({ todos: [{ content: "write the parser", status: "in_progress" }] }, null));
    expect(todoStatusChip()).toBe("todos 0/1 · write the parser");
    clearTodos();
    expect(todoStatusChip()).toBeNull();
  });
});

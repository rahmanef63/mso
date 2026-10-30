import { describe, expect, it } from "vitest";
import { groupToolRows, transcriptLines, transcriptStats } from "./mso-agent-transcript.mjs";

describe("mso-agent-transcript", () => {
  it("1. a realistic session with a user row, an assistant row with toolUses, and several tool rows renders in order with distinguishable prefixes and no ANSI when no palette is passed", () => {
    const session = {
      history: [
        { role: "user", text: "Please list the files and check git status." },
        {
          role: "assistant",
          text: "I will list the directory and check git status.",
          toolUses: [
            { id: "call_1", name: "fs_list", input: { path: "src" } },
            { id: "call_2", name: "git_status", input: {} },
          ],
        },
        {
          role: "tool",
          results: [
            { id: "call_1", content: "index.ts\napp.ts" },
            { id: "call_2", content: "clean" },
          ],
        },
      ],
    };
    const lines = transcriptLines(session);
    expect(lines[0]).toBe("[user] Please list the files and check git status.");
    expect(lines[1]).toBe("[assistant] I will list the directory and check git status.");
    expect(lines[2]).toBe('[assistant] call fs_list {"path":"src"}');
    expect(lines[3]).toBe("[assistant] call git_status");
    expect(lines.some((line) => line.startsWith("[tool] fs_list:"))).toBe(true);
    expect(lines.some((line) => line.startsWith("[tool] git_status:"))).toBe(true);
    for (const line of lines) expect(/\x1b\[[0-9;]*m/.test(line)).toBe(false);
  });

  it("2. consecutive tool rows of the same tool collapse into one counted row, and the count is right", () => {
    const lines = [
      "[user] Read configuration",
      "[tool] fs_read: config1",
      "[tool] fs_read: config2",
      "[tool] fs_read: config3",
      "[user] Done",
    ];
    const collapsed = groupToolRows(lines, { maxPerTool: 1 });
    expect(collapsed).toContain("[tool] fs_read (3 calls)");
    expect(collapsed).not.toContain("[tool] fs_read: config1");
    expect(collapsed[0]).toBe("[user] Read configuration");
    expect(collapsed[collapsed.length - 1]).toBe("[user] Done");

    const session = {
      history: [
        {
          role: "assistant",
          toolUses: [{ id: "c1", name: "fs_read" }, { id: "c2", name: "fs_read" }, { id: "c3", name: "fs_read" }],
        },
        {
          role: "tool",
          results: [{ id: "c1", content: "d1" }, { id: "c2", content: "d2" }, { id: "c3", content: "d3" }],
        },
      ],
    };
    expect(transcriptLines(session, { groupTools: true, maxPerTool: 1 })).toContain("[tool] fs_read (3 calls)");
  });

  it("3. an assistant row with text but no tools still renders its text", () => {
    const session = { history: [{ role: "assistant", text: "Everything has been resolved successfully." }] };
    expect(transcriptLines(session)).toEqual(["[assistant] Everything has been resolved successfully."]);
  });

  it("4. an agent row renders with its own prefix", () => {
    const session = {
      history: [{ role: "agent", text: "Task completed by subagent.", senderLabel: "worker-1" }],
    };
    const lines = transcriptLines(session);
    expect(lines.length).toBe(1);
    expect(lines[0].startsWith("[agent] ")).toBe(true);
    expect(lines[0]).toContain("@worker-1: Task completed by subagent.");
  });

  it("5. malformed rows (null, {}, a row with a non-string content, a tool row with no result, a huge result over a clip threshold) do not throw, and the huge result is clipped with a visible marker", () => {
    const huge = "A".repeat(5000);
    const session = {
      history: [
        null, {},
        { role: "user", text: 12345 },
        { role: "tool" },
        { role: "tool", results: [] },
        { role: "tool", results: [null, {}] },
        { role: "tool", results: [{ id: "c_huge", name: "sys_log", content: huge }] },
      ],
    };
    let lines: string[] = [];
    expect(() => { lines = transcriptLines(session as any, { clipLimit: 500 }); }).not.toThrow();
    expect(lines.some((l) => l.includes("[user] 12345"))).toBe(true);
    expect(lines.some((l) => l.includes("[tool] tool: (no result)"))).toBe(true);
    const hugeLine = lines.find((l) => l.includes("sys_log"));
    expect(hugeLine).toBeDefined();
    expect(hugeLine!).toContain("[clipped]");
    expect(hugeLine!.length).toBeLessThan(1000);
  });

  it("6. transcriptStats counts match the fixture", () => {
    const session = {
      history: [
        { role: "user", text: "First prompt" },
        { role: "assistant", text: "Looking into it", toolUses: [{ id: "1", name: "fs_read" }, { id: "2", name: "fs_write" }] },
        { role: "tool", results: [{ id: "1", content: "ok" }, { id: "2", content: "written" }] },
        { role: "user", text: "Second prompt" },
        { role: "assistant", text: "Finished work", toolUses: [{ id: "3", name: "git_diff" }] },
        { role: "tool", results: [{ id: "3", content: "diff" }] },
        { role: "agent", text: "background task done", senderLabel: "worker" },
      ],
    };
    expect(transcriptStats(session)).toEqual({ rows: 7, userTurns: 2, assistantTurns: 2, toolCalls: 3 });
  });

  it("7. determinism: calling twice returns deeply equal arrays", () => {
    const session = {
      history: [
        { role: "user", text: "Verify deterministic output" },
        { role: "assistant", text: "Running checks", toolUses: [{ id: "c1", name: "test_tool", input: { flag: true } }] },
        { role: "tool", results: [{ id: "c1", content: "result value" }] },
      ],
    };
    expect(transcriptLines(session)).toEqual(transcriptLines(session));
  });

  it("8. a tool row whose result is already a compacted placeholder (the shape stored by the context module) renders the placeholder rather than undefined", () => {
    const payload = {
      msoReplay: true, rawResultBytes: 4096,
      handles: [{ kind: "file", path: "/repo/src/app.ts", rereadWith: "read_pipeline" }],
      instruction: "Re-read only the needed handle with the bounded read/status surface.",
    };
    const session = {
      history: [
        { role: "assistant", text: "", toolUses: [{ id: "r1", name: "fs_read", input: { path: "/repo/src/app.ts" } }] },
        { role: "tool", results: [{ id: "r1", isError: false, msoReplay: true, content: JSON.stringify(payload) }] },
      ],
    };
    const lines = transcriptLines(session);
    const toolLine = lines.find((l) => l.startsWith("[tool] fs_read"));
    expect(toolLine).toBeDefined();
    expect(toolLine).toContain("compacted replay");
    expect(toolLine).toContain("/repo/src/app.ts");
    expect(toolLine).toContain("Re-read only the needed handle");
    expect(lines.every((l) => !l.includes("undefined"))).toBe(true);
  });

  it("reuses formatEditDiff, formatTodoBlock, and formatDiffBody when tool results match", () => {
    const edit = { path: "/repo/src/main.ts", written: true, diff: "--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new\n" };
    const todo = { items: [{ status: "completed", content: "step one" }], summary: { count: 1, completed: 1 } };
    const diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+new";
    const session = {
      history: [
        { role: "tool", name: "fs_edit", results: [{ id: "e", content: JSON.stringify(edit) }] },
        { role: "tool", name: "agent_todo", results: [{ id: "t", content: JSON.stringify(todo) }] },
        { role: "tool", name: "git_diff", results: [{ id: "d", content: diff }] },
      ],
    };
    const lines = transcriptLines(session);
    expect(lines.some((l) => l.includes("edit main.ts"))).toBe(true);
    expect(lines.some((l) => l.includes("[x] step one"))).toBe(true);
    expect(lines.some((l) => l.includes("diff --git a/f"))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { cellWidth, stripAnsi } from "./tui/cells.mjs";
import { cyclePane, paneKinds, paneLines, paneWidth } from "./mso-agent-pane.mjs";
import { mountScreenLoop } from "./mso-agent-screen-loop.mjs";
import { handleSessionCommand } from "./mso-agent-cmd-session.mjs";

describe("mso-agent-pane", () => {
  it("cyclePane wraps through every kind and handles unknown fallback", () => {
    const kinds = paneKinds();
    expect(kinds).toEqual(["todos", "diff", "files", "mcp", "context", "off"]);
    expect(cyclePane("todos")).toBe("diff");
    expect(cyclePane("diff")).toBe("files");
    expect(cyclePane("files")).toBe("mcp");
    expect(cyclePane("off")).toBe("todos");
    expect(cyclePane("unknown")).toBe("todos");
  });

  it("paneWidth returns 0 below the minimum and a sane value above it", () => {
    expect(paneWidth(60)).toBe(0);
    expect(paneWidth(80)).toBe(0);
    expect(paneWidth(99)).toBe(0);
    expect(paneWidth(100)).toBe(35);
    expect(paneWidth(120)).toBe(42);
    expect(paneWidth(160)).toBe(50);
    expect(paneWidth(200)).toBe(50);
  });

  it("each kind renders exactly rows lines and no line exceeds width, including CJK at boundary", () => {
    const sampleData = {
      todos: { items: [{ content: "テスト内容の日本語テキスト境界確認", status: "in_progress" }] },
      lastDiff: { path: "src/日本語.ts", diff: "--- a\n+++ b\n@@ -1 +1 @@\n-旧コード\n+新コード境界値確認\n" },
      files: ["src/日本語ファイル名テスト.ts", "lib/main.mjs"],
    };

    for (const kind of paneKinds()) {
      for (const w of [30, 42, 50]) {
        for (const r of [1, 2, 3, 4, 10, 20]) {
          const lines = paneLines({
            kind,
            todos: sampleData.todos,
            lastDiff: sampleData.lastDiff,
            files: sampleData.files,
            width: w,
            rows: r,
          });
          expect(lines.length).toBe(r);
          for (const line of lines) {
            expect(cellWidth(line)).toBeLessThanOrEqual(w);
            expect(cellWidth(line)).toBe(w);
          }
        }
      }
    }
  });

  it("verifies CJK character right at cell boundary never exceeds width", () => {
    // Width 12 has inner cell width 10. Placing a 2-cell CJK character across boundary.
    const trickyLines = paneLines({
      kind: "files",
      files: ["123456789日本語テスト"],
      width: 12,
      rows: 6,
    });
    expect(trickyLines.length).toBe(6);
    for (const line of trickyLines) {
      expect(cellWidth(line)).toBe(12);
    }
  });

  it("an empty kind shows the nothing here line instead of blank", () => {
    const todosEmpty = paneLines({ kind: "todos", todos: { items: [] }, width: 35, rows: 8 });
    const todosText = todosEmpty.map((l) => stripAnsi(l)).join("\n");
    expect(todosText).toContain("no todos in this session");

    const diffEmpty = paneLines({ kind: "diff", lastDiff: null, width: 35, rows: 8 });
    const diffText = diffEmpty.map((l) => stripAnsi(l)).join("\n");
    expect(diffText).toContain("no edits in this session");

    const filesEmpty = paneLines({ kind: "files", files: [], width: 35, rows: 8 });
    const filesText = filesEmpty.map((l) => stripAnsi(l)).join("\n");
    expect(filesText).toContain("no changed files");

    const offEmpty = paneLines({ kind: "off", width: 35, rows: 8 });
    const offText = offEmpty.map((l) => stripAnsi(l)).join("\n");
    expect(offText).toContain("pane is off");
  });

  it("no ANSI when no palette is passed", () => {
    const kinds = paneKinds();
    for (const kind of kinds) {
      const lines = paneLines({
        kind,
        width: 40,
        rows: 8,
        colors: {},
        todos: { items: [{ content: "clean", status: "completed" }] },
      });
      for (const line of lines) {
        expect(line.includes("\x1b")).toBe(false);
        expect(stripAnsi(line)).toBe(line);
      }
    }
  });

  it("with the loop disabled, zero writes", () => {
    const writes: string[] = [];
    const fakeStdout = {
      isTTY: true,
      columns: 120,
      rows: 24,
      write(chunk: string) {
        writes.push(chunk);
      },
      on() {},
      off() {},
    };
    const fakeStdin = {
      emit() { return true; },
    };

    const session = {
      history: [{ role: "user", text: "hello" }],
      paneKind: "todos",
    };

    const loop = mountScreenLoop({
      session,
      enabled: false,
      output: fakeStdout as any,
      input: fakeStdin as any,
    });

    expect(loop.active).toBe(false);
    expect(writes.length).toBe(0);

    loop.paint();
    expect(writes.length).toBe(0);

    loop.sync();
    expect(writes.length).toBe(0);

    loop.dispose();
    expect(writes.length).toBe(0);
  });

  it("dispatches /pane to cycle kinds and set specific kind", async () => {
    const session: any = { paneKind: "off" };
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => { logs.push(msg); };

    try {
      const ctx = { session, C: {} };
      // Cycle from off to todos
      const r1 = await handleSessionCommand(ctx, "/pane", []);
      expect(r1).toBe("handled");
      expect(session.paneKind).toBe("todos");

      // Set specific kind
      const r2 = await handleSessionCommand(ctx, "/pane", ["diff"]);
      expect(r2).toBe("handled");
      expect(session.paneKind).toBe("diff");

      // Invalid kind shows usage
      const r3 = await handleSessionCommand(ctx, "/pane", ["invalid"]);
      expect(r3).toBe("handled");
      expect(logs[logs.length - 1]).toContain("usage: /pane");
    } finally {
      console.log = origLog;
    }
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { createPrinter } from "./mso-agent-print.mjs";
import { handleTodos } from "./mso-agent-cmd-session.mjs";
import { handleJobsCommand, printJobs } from "./mso-agent-jobs.mjs";
import { rememberTodos, resetTodosForTesting } from "./mso-agent-todos.mjs";

describe("mso-agent-print", () => {
  beforeEach(() => {
    resetTodosForTesting();
  });

  // Test 1: no sink configured routes to writer unchanged.
  it("routes print, printLines, and printBlock to writer in order when no sink installed", () => {
    const captured: string[] = [];
    const write = (line: string) => captured.push(line);
    const printer = createPrinter({ write });

    printer.print("line 1");
    printer.printLines(["line 2", "line 3"]);
    printer.printBlock("line 4\nline 5");

    expect(captured).toEqual(["line 1", "line 2", "line 3", "line 4", "line 5"]);
  });

  // Test 2: sink installed on session receives lines, writer receives nothing.
  it("routes output to session.printSink when installed, leaving writer untouched", () => {
    const capturedWriter: string[] = [];
    const capturedSink: string[] = [];
    const session: Record<string, any> = {
      printSink: (line: string) => capturedSink.push(line),
    };
    const printer = createPrinter({
      session,
      write: (line: string) => capturedWriter.push(line),
    });

    printer.print("message 1");
    printer.printLines(["message 2", "message 3"]);

    expect(capturedSink).toEqual(["message 1", "message 2", "message 3"]);
    expect(capturedWriter).toEqual([]);
  });

  // Test 3: a multi-line block split on newlines arrives as individual lines at the sink.
  it("splits a multi-line block into individual lines at the sink", () => {
    const capturedSink: string[] = [];
    const session: Record<string, any> = {
      printSink: (line: string) => capturedSink.push(line),
    };
    const printer = createPrinter({ session });

    printer.printBlock("alpha\nbeta\ngamma");

    expect(capturedSink).toEqual(["alpha", "beta", "gamma"]);
    expect(capturedSink.length).toBe(3);
  });

  // Test 4: a failing sink must not drop the message and must fall back to writer.
  it("falls back to writer when session.printSink throws so lines are never lost", () => {
    const capturedWriter: string[] = [];
    const session: Record<string, any> = {
      printSink: () => {
        throw new Error("simulated sink failure");
      },
    };
    const printer = createPrinter({
      session,
      write: (line: string) => capturedWriter.push(line),
    });

    printer.print("critical message");
    printer.printBlock("block line 1\nblock line 2");

    expect(capturedWriter).toEqual(["critical message", "block line 1", "block line 2"]);
  });

  // Test 5: removing the sink dynamically restores writing to the fallback writer.
  it("restores writer when printSink is removed from the session", () => {
    const capturedWriter: string[] = [];
    const capturedSink: string[] = [];
    const session: Record<string, any> = {
      printSink: (line: string) => capturedSink.push(line),
    };
    const printer = createPrinter({
      session,
      write: (line: string) => capturedWriter.push(line),
    });

    printer.print("to sink");
    expect(capturedSink).toEqual(["to sink"]);
    expect(capturedWriter).toEqual([]);

    delete session.printSink;

    printer.print("to writer");
    expect(capturedWriter).toEqual(["to writer"]);
  });

  // Test 6: migrated slash commands produce exact expected output with no sink.
  it("migrated /todos command produces byte-identical output with no sink installed", async () => {
    const captured: string[] = [];
    const write = (line: string) => captured.push(line);
    const ctx = {
      C: {},
      session: {},
      write,
    };

    // When no checklist exists, /todos writes a fixed explanatory prompt.
    await handleTodos(ctx, []);
    expect(captured).toEqual([
      "no todo list in this session yet: the agent writes one with todo_write",
    ]);

    captured.length = 0;
    rememberTodos({
      items: [
        { content: "implement print sink", status: "completed" },
        { content: "verify byte equality", status: "in_progress" },
      ],
      summary: null,
    });

    await handleTodos(ctx, []);
    expect(captured).toEqual([
      "  [x] implement print sink",
      "  [~] verify byte equality",
    ]);
  });

  it("migrated /jobs command produces exact output with no sink installed", async () => {
    const captured: string[] = [];
    const write = (line: string) => captured.push(line);
    const ctx = {
      C: {},
      session: null,
      write,
    };

    await handleJobsCommand(ctx, ["cancel"]);
    expect(captured).toEqual(["usage: /jobs cancel <id>"]);

    const directOutput = printJobs([], { colors: {}, print: write });
    expect(directOutput).toBe("no background subagent jobs found");
    expect(captured[1]).toBe("no background subagent jobs found");
  });
});

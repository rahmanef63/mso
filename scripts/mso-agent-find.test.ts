import { describe, expect, it } from "vitest";
import { findMatches, offsetForLine } from "./mso-agent-find.mjs";
import { handleFindCommand } from "./mso-agent-cmd-find.mjs";
import {
  appendLines,
  createViewport,
  resetFollow,
  setLines,
  viewportWindow,
} from "./mso-agent-viewport.mjs";

describe("transcript search (/find)", () => {
  it("(1) three occurrences produce three indexes", () => {
    const lines = [
      "first line without keyword",
      "target occurrence one here",
      "some other text",
      "third line neutral",
      "target occurrence two here",
      "filler content",
      "more filler content",
      "almost at the end",
      "target occurrence three here",
      "final closing line",
    ];
    const indexes = findMatches(lines, "target");
    expect(indexes).toEqual([1, 4, 8]);
  });

  it("(2) matching ignores ANSI styling, proven with a line containing colour codes", () => {
    // Styling tags are interspersed across role markers and keywords.
    const styledLine = "\x1b[34m[user]\x1b[0m \x1b[1mhello\x1b[0m \x1b[32mworld\x1b[0m of agents";
    const plainLine = "just another plain line";
    const lines = [styledLine, plainLine];

    // Substring across boundaries that contain color escape codes matches plain text.
    expect(findMatches(lines, "hello world")).toEqual([0]);
    // Case-insensitive matching works with styled lines.
    expect(findMatches(lines, "[USER]")).toEqual([0]);
    expect(findMatches(lines, "WORLD OF AGENTS")).toEqual([0]);
    // Raw escape sequences themselves should not match plain text search.
    expect(findMatches(lines, "\x1b[34m")).toEqual([]);
  });

  it("(3) /find jumps to the first match and the offset makes it visible", async () => {
    const vp = createViewport({ rows: 10 });
    const buffer = Array.from({ length: 60 }, (_, i) => `line ${i}: message`);
    buffer[15] = "line 15: findme unique token";
    buffer[35] = "line 35: findme unique token";
    setLines(vp, buffer);

    const logged: string[] = [];
    const session = { _findState: null };
    const ctx = {
      session,
      viewport: vp,
      printer: { print: (msg: string) => logged.push(msg) },
    };

    // Before search: viewport is at offset 0 (pinned to bottom, lines 50..59 visible).
    expect(vp.offset).toBe(0);

    await handleFindCommand(ctx, ["findme"]);

    // First match is at index 15; offset must place line 15 within visible window.
    expect(logged[0]).toMatch(/2 matches.*match 1\/2.*line 16/);
    const win = viewportWindow(vp, 10);
    expect(win.start).toBeLessThanOrEqual(15);
    expect(win.end).toBeGreaterThan(15);
    expect(win.lines).toContain("line 15: findme unique token");
  });

  it("(4) repeated find wraps", async () => {
    const vp = createViewport({ rows: 10 });
    const buffer = Array.from({ length: 50 }, (_, i) => `entry ${i}`);
    buffer[10] = "entry 10: needle";
    buffer[25] = "entry 25: needle";
    buffer[40] = "entry 40: needle";
    setLines(vp, buffer);

    const logged: string[] = [];
    const session = { _findState: null };
    const ctx = {
      session,
      viewport: vp,
      printer: { print: (msg: string) => logged.push(msg) },
    };

    // First search jumps to match 1 (index 10).
    await handleFindCommand(ctx, ["needle"]);
    let win = viewportWindow(vp, 10);
    expect(win.start).toBeLessThanOrEqual(10);
    expect(win.end).toBeGreaterThan(10);
    expect(logged.at(-1)).toMatch(/3 matches.*match 1\/3.*line 11/);

    // Repeated search with same query jumps to match 2 (index 25).
    await handleFindCommand(ctx, ["needle"]);
    win = viewportWindow(vp, 10);
    expect(win.start).toBeLessThanOrEqual(25);
    expect(win.end).toBeGreaterThan(25);
    expect(logged.at(-1)).toMatch(/3 matches.*match 2\/3.*line 26/);

    // Search with --next jumps to match 3 (index 40).
    await handleFindCommand(ctx, ["--next"]);
    win = viewportWindow(vp, 10);
    expect(win.start).toBeLessThanOrEqual(40);
    expect(win.end).toBeGreaterThan(40);
    expect(logged.at(-1)).toMatch(/3 matches.*match 3\/3.*line 41/);

    // Next repeated find wraps back to match 1 (index 10).
    await handleFindCommand(ctx, ["needle"]);
    win = viewportWindow(vp, 10);
    expect(win.start).toBeLessThanOrEqual(10);
    expect(win.end).toBeGreaterThan(10);
    expect(logged.at(-1)).toMatch(/3 matches.*match 1\/3.*line 11/);
  });

  it("(5) a query with no match reports zero and does not scroll", async () => {
    const vp = createViewport({ rows: 10 });
    const buffer = Array.from({ length: 40 }, (_, i) => `item ${i}`);
    setLines(vp, buffer);
    vp.offset = 7; // User has scrolled up manually

    const logged: string[] = [];
    const session = { _findState: null };
    const ctx = {
      session,
      viewport: vp,
      printer: { print: (msg: string) => logged.push(msg) },
    };

    await handleFindCommand(ctx, ["nonexistent_query"]);
    expect(logged[0]).toBe('0 matches for "nonexistent_query"');
    // Scroll offset must not have changed.
    expect(vp.offset).toBe(7);
  });

  it("(6) an empty query is refused with a message", async () => {
    const vp = createViewport({ rows: 10 });
    setLines(vp, ["some line"]);

    const logged: string[] = [];
    const session = { _findState: null };
    const ctx = {
      session,
      viewport: vp,
      printer: { print: (msg: string) => logged.push(msg) },
    };

    // No prior query on session.
    await handleFindCommand(ctx, []);
    expect(logged[0]).toBe("no previous query: use /find <query>");

    // Empty string argument passed explicitly.
    await handleFindCommand(ctx, [""]);
    expect(logged[1]).toBe("empty query: use /find <query>");

    // Whitespace only argument.
    await handleFindCommand(ctx, ["   "]);
    expect(logged[2]).toBe("empty query: use /find <query>");
  });

  it("setting an offset does not corrupt follow mode and returns cleanly on new prompt", () => {
    const vp = createViewport({ rows: 10 });
    const buffer = Array.from({ length: 60 }, (_, i) => `line ${i}`);
    setLines(vp, buffer);

    // Initially in follow mode (pinned to bottom, offset 0).
    expect(vp.offset).toBe(0);
    expect(viewportWindow(vp, 10).follow).toBe(true);

    // Find sets offset to inspect historical match at line 12.
    vp.offset = offsetForLine(vp, 12, 10);
    expect(vp.offset).toBeGreaterThan(0);
    // Follow mode is now off while the user browses the transcript.
    expect(viewportWindow(vp, 10).follow).toBe(false);

    // When the user submits a new prompt, follow mode is reset.
    resetFollow(vp);
    expect(vp.offset).toBe(0);
    expect(viewportWindow(vp, 10).follow).toBe(true);

    // New stream output arrives and remains visible at the bottom.
    appendLines(vp, ["line 60 (fresh response)"]);
    const win = viewportWindow(vp, 10);
    expect(win.follow).toBe(true);
    expect(win.lines.at(-1)).toBe("line 60 (fresh response)");
  });
});

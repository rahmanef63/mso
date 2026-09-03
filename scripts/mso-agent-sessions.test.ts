import { describe, expect, it } from "vitest";
import { formatSessionModified, resolveSessionQuery, sessionCompletionItems, sessionPromptHistory, visibleSessionRows } from "./mso-agent-sessions.mjs";

const rows = [
  { id: "20260901_120000_aaaaaaaa", name: "milo", title: "Deploy Example Project", source: "cli", historyTurns: 10, createdAt: "2026-09-01T11:50:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" },
  { id: "20260901_110000_bbbbbbbb", name: "luna", title: "Audit MSO", source: "cli", historyTurns: 4, createdAt: "2026-09-01T10:50:00.000Z", updatedAt: "2026-09-01T11:00:00.000Z" },
  { id: "20260901_100000_cccccccc", name: "nara", title: "Older Example notes", source: "cli", historyTurns: 2, createdAt: "2026-09-01T09:50:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z" },
];

describe("MSO Agent session resolver", () => {
  it("resumes newest, list index, exact id, short id, @name and unique title", () => {
    const unordered = [rows[2], rows[0], rows[1]];
    expect(resolveSessionQuery(unordered, "latest").session?.id).toBe(rows[0].id);
    expect(resolveSessionQuery(unordered, "2").session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, rows[1].id).session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, "bbbbbbbb").session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, "@luna").session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, "Audit MSO").session?.id).toBe(rows[1].id);
  });

  it("refuses ambiguous fuzzy titles instead of guessing", () => {
    const result = resolveSessionQuery(rows, "Example");
    expect(result.session).toBeNull();
    expect(result.ambiguous).toHaveLength(2);
  });

  it("builds a newest-first @name picker with hidden ids, title and last-modified metadata", () => {
    const now = Date.parse("2026-09-01T12:05:00.000Z");
    const items = sessionCompletionItems([rows[1], rows[0], rows[2]], "", now);
    expect(items.map((item) => item.text)).toEqual(["@milo", "@luna", "@nara"]);
    expect(items[0]).toMatchObject({ text: "@milo", value: rows[0].id, meta: "Deploy Example Project · modified 5m ago" });
    expect(`${items[0].text} ${items[0].meta}`).not.toContain(rows[0].id);
    expect(sessionCompletionItems(rows, "audit", now)).toHaveLength(1);
    expect(sessionCompletionItems(rows, "bbbbbbbb", now)[0]?.text).toBe("@luna");
    expect(sessionCompletionItems(rows, "luna", now)[0]?.text).toBe("@luna");
  });

  it("formats last-modified time compactly", () => {
    const now = Date.parse("2026-09-02T12:00:00.000Z");
    expect(formatSessionModified("2026-09-02T11:59:40.000Z", now)).toBe("just now");
    expect(formatSessionModified("2026-09-02T11:55:00.000Z", now)).toBe("5m ago");
    expect(formatSessionModified("2026-09-02T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatSessionModified("2026-08-20T09:00:00.000Z", now)).toBe("2026-08-20");
  });

  it("seeds terminal history from durable user prompts newest first", () => {
    expect(sessionPromptHistory([
      { role: "user", text: "first prompt" },
      { role: "assistant", text: "answer" },
      { role: "tool", text: "ignored" },
      { role: "user", text: "second\nprompt" },
    ])).toEqual(["second prompt", "first prompt"]);
  });

  it("hides empty default CLI clutter but keeps named and non-CLI sessions", () => {
    const clutter = { id: "empty", name: "milo", source: "cli", title: "MSO Agent session", titleSource: "default", historyTurns: 0, updatedAt: "2026-09-02T10:00:00Z" };
    const named = { id: "named", name: "luna", source: "cli", title: "Deploy MSO", titleSource: "manual", historyTurns: 0, updatedAt: "2026-09-02T09:00:00Z" };
    const mcp = { id: "mcp", name: "nara", source: "mcp", title: "ChatGPT task", titleSource: "auto", historyTurns: 0, updatedAt: "2026-09-02T08:00:00Z" };
    expect(visibleSessionRows([clutter, named, mcp]).map((row) => row.id)).toEqual(["named", "mcp"]);
    const items = sessionCompletionItems([clutter, named, mcp], "", Date.parse("2026-09-02T10:05:00Z"), "named");
    expect(items.map((row) => row.text)).toEqual(["@luna", "@nara"]);
    expect(items[0].meta).toContain("current");
  });

});

import { describe, expect, it } from "vitest";
import { resolveSessionQuery, sessionCompletionItems } from "./mso-agent-sessions.mjs";

const rows = [
  { id: "20260901_120000_aaaaaaaa", title: "Deploy Baton", source: "cli", historyTurns: 10 },
  { id: "20260901_110000_bbbbbbbb", title: "Audit MSO", source: "cli", historyTurns: 4 },
  { id: "20260901_100000_cccccccc", title: "Older Baton notes", source: "cli", historyTurns: 2 },
];

describe("MSO Agent session resolver", () => {
  it("resumes latest, list index, exact id, short id and unique title", () => {
    expect(resolveSessionQuery(rows, "latest").session?.id).toBe(rows[0].id);
    expect(resolveSessionQuery(rows, "2").session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, rows[1].id).session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, "bbbbbbbb").session?.id).toBe(rows[1].id);
    expect(resolveSessionQuery(rows, "Audit MSO").session?.id).toBe(rows[1].id);
  });

  it("refuses ambiguous fuzzy titles instead of guessing", () => {
    const result = resolveSessionQuery(rows, "Baton");
    expect(result.session).toBeNull();
    expect(result.ambiguous).toHaveLength(2);
  });

  it("builds searchable session picker items", () => {
    expect(sessionCompletionItems(rows, "audit")).toHaveLength(1);
    expect(sessionCompletionItems(rows, "")[0].meta).toContain("10 turns");
  });
});

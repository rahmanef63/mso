import { describe, expect, it, vi } from "vitest";
import { canonicalAgentApproval } from "../lib/agent/approval.mjs";
import {
  ApprovalSummaryFormatter,
  approvalRepeatMarker,
  extractApprovalTarget,
  formatApprovalSummary,
} from "./mso-agent-approval-summary.mjs";
import { requestExactToolApproval } from "./mso-agent-approval-ui.mjs";

describe("TUI approval summary and repetition tracking", () => {
  const toolA = { name: "exec_run", scope: "exec" };
  const inputA = { command: "npm test", token: "secret123" };
  const approvalA = canonicalAgentApproval(toolA.name, inputA);

  const toolB = { name: "fs_write", scope: "write" };
  const inputB = { path: "src/config.json", content: "{}" };
  const approvalB = canonicalAgentApproval(toolB.name, inputB);

  it("(1) first approval shows no repeat marker", () => {
    // Tests that the initial presentation of an action does not display phantom repeat indicators.
    const formatter = new ApprovalSummaryFormatter();
    const summary = formatter.format(toolA, inputA, approvalA);
    expect(summary).toBe("exec_run: npm test");
    expect(summary).not.toMatch(/approved|already|once|twice/i);
  });

  it("(2) second approval of the same digest shows it", () => {
    // Tests that once a digest has been allowed, subsequent identical prompts display repeat counts.
    const formatter = new ApprovalSummaryFormatter();
    formatter.record(approvalA);
    const second = formatter.format(toolA, inputA, approvalA);
    expect(second).toBe("exec_run: npm test (approved once already)");

    formatter.record(approvalA);
    const third = formatter.format(toolA, inputA, approvalA);
    expect(third).toBe("exec_run: npm test (approved twice already)");
  });

  it("(3) a different digest resets to no marker", () => {
    // Tests that repeat state is bound strictly to the canonical digest rather than consecutive calls.
    const formatter = new ApprovalSummaryFormatter();
    formatter.record(approvalA);
    const summaryB = formatter.format(toolB, inputB, approvalB);
    expect(summaryB).toBe("fs_write: src/config.json");
    expect(summaryB).not.toMatch(/approved|already/i);
  });

  it("(4) a resumed session starts with an empty counter, asserted by constructing a fresh formatter", () => {
    // Tests that resuming a session does not carry over in-memory counts from prior sessions.
    const priorFormatter = new ApprovalSummaryFormatter();
    priorFormatter.record(approvalA);
    priorFormatter.record(approvalA);
    expect(priorFormatter.getCount(approvalA)).toBe(2);

    const resumedFormatter = new ApprovalSummaryFormatter();
    expect(resumedFormatter.getCount(approvalA)).toBe(0);
    const resumedSummary = resumedFormatter.format(toolA, inputA, approvalA);
    expect(resumedSummary).toBe("exec_run: npm test");
    expect(resumedSummary).not.toMatch(/approved|already/i);
  });

  it("(5) the summary never contains the raw digest unless it was already shown today, and say what you chose", () => {
    // We chose to keep the summary digest-free because raw hashes clutter single-line prompts;
    // full digests remain available in the expandable detail section.
    const formatter = new ApprovalSummaryFormatter();
    const s1 = formatter.format(toolA, inputA, approvalA);
    formatter.record(approvalA);
    const s2 = formatter.format(toolA, inputA, approvalA);
    const s3 = formatter.format(toolB, inputB, approvalB);

    expect(s1).not.toContain(approvalA.digest);
    expect(s2).not.toContain(approvalA.digest);
    expect(s3).not.toContain(approvalB.digest);
  });

  it("extracts targets safely and redacts credentials from summary lines", () => {
    // Prevents sensitive command parameters from printing in unredacted summary logs.
    const target = extractApprovalTarget({ command: "curl -H 'Authorization: Bearer topsecret' https://api" });
    expect(target).toContain("Bearer [redacted]");
    expect(target).not.toContain("topsecret");

    const moveTarget = extractApprovalTarget({ from: "old.txt", to: "new.txt" });
    expect(moveTarget).toBe("old.txt -> new.txt");

    expect(extractApprovalTarget({}, { name: "sys_status" })).toBe("");
    expect(formatApprovalSummary({ name: "sys_status" })).toBe("sys_status");
  });

  it("handles repeat marker pluralization above two occurrences", () => {
    // Formats counts greater than two with generic numeric phrasing.
    expect(approvalRepeatMarker(0)).toBe("");
    expect(approvalRepeatMarker(1)).toBe("approved once already");
    expect(approvalRepeatMarker(2)).toBe("approved twice already");
    expect(approvalRepeatMarker(5)).toBe("approved 5 times already");
  });

  it("integrates with requestExactToolApproval without regressing the prompt cycle", async () => {
    // Tests end-to-end prompt suspension, summary printing, and approval recording.
    const formatter = new ApprovalSummaryFormatter();
    const printed: string[] = [];
    const print = (line: string) => printed.push(line);

    let allowDecision = true;
    const rl = {
      question: vi.fn(async (prompt: string | (() => string)) => {
        const text = typeof prompt === "function" ? prompt() : prompt;
        if (text.includes("Approval needed")) return "";
        return allowDecision ? "allow" : "deny";
      }),
    };

    // First prompt confirmation.
    const result1 = await requestExactToolApproval(rl, {
      tool: toolA,
      input: inputA,
      approval: approvalA,
      print,
      summaryFormatter: formatter,
    });
    expect(result1).toBe(true);
    expect(printed[0]).toBe("exec_run: npm test");

    // Second prompt confirmation with matching digest.
    printed.length = 0;
    const result2 = await requestExactToolApproval(rl, {
      tool: toolA,
      input: inputA,
      approval: approvalA,
      print,
      summaryFormatter: formatter,
    });
    expect(result2).toBe(true);
    expect(printed[0]).toBe("exec_run: npm test (approved once already)");

    // Denied prompt does not increment counter.
    allowDecision = false;
    printed.length = 0;
    const result3 = await requestExactToolApproval(rl, {
      tool: toolB,
      input: inputB,
      approval: approvalB,
      print,
      summaryFormatter: formatter,
    });
    expect(result3).toBe(false);
    expect(printed[0]).toBe("fs_write: src/config.json");
    expect(formatter.getCount(approvalB)).toBe(0);
  });
});

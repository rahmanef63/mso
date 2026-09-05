import { describe, expect, it, vi } from "vitest";
import { canonicalAgentApproval, matchesAgentApproval } from "../lib/agent/approval.mjs";
import { approvalArgsSummary, approvalDetailLines, approvalStatusLine, requestExactToolApproval } from "./mso-agent-approval-ui.mjs";

describe("compact exact-call approval UX", () => {
  const tool = { name: "exec_run", scope: "exec" };
  const input = { command: "npm run typecheck", password: "supersecret" };
  const approval = canonicalAgentApproval(tool.name, input);

  it("keeps the default status to one safe line without payload, digest, bytes, or YOLO noise", () => {
    const line = approvalStatusLine(tool, input);
    expect(line).toBe("Approval needed: exec_run — run npm run typecheck");
    expect(line).not.toContain("supersecret");
    expect(line).not.toContain(approval.digest);
    expect(line).not.toMatch(/bytes|yolo|\{.*\}/i);
  });

  it("opens redacted exact-call details and preserves the canonical digest", () => {
    expect(approvalArgsSummary(input)).toContain('"password":"[redacted]"');
    expect(approvalArgsSummary(input)).not.toContain("supersecret");
    const details = approvalDetailLines(tool, input, approval).join("\n");
    expect(details).toContain("exec_run");
    expect(details).toContain("npm run typecheck");
    expect(details).toContain(approval.digest);
    expect(matchesAgentApproval(tool.name, approval.payload.input, approval.digest)).toBe(true);
  });

  it("lets Tab focus the pending action but requires a separate explicit allow decision", async () => {
    const prompts: string[] = [], printed: string[] = [];
    let calls = 0;
    const rl = { question: vi.fn(async (prompt: string | (() => string), options: { onTab?: () => void }) => {
      calls += 1;
      prompts.push(typeof prompt === "function" ? prompt() : prompt);
      if (calls === 1) {
        options.onTab?.();
        prompts.push(typeof prompt === "function" ? prompt() : prompt);
        return "";
      }
      return "allow";
    }) };
    await expect(requestExactToolApproval(rl, { tool, input, approval, print: (line: string) => printed.push(line) })).resolves.toBe(true);
    expect(prompts[0]).toContain("Approval needed: exec_run");
    expect(prompts[1]).toContain("▸ Approval needed: exec_run");
    expect(calls).toBe(2);
    expect(printed.join("\n")).toContain("choose  allow or deny");
  });

  it("does not approve Enter/details alone and supports explicit deny", async () => {
    let calls = 0;
    const rl = { question: vi.fn(async () => (++calls === 1 ? "" : "deny")) };
    await expect(requestExactToolApproval(rl, { tool, input, approval, print: () => {} })).resolves.toBe(false);
    expect(calls).toBe(2);
  });
});

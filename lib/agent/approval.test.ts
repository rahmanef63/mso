import { describe, expect, it } from "vitest";
import { canonicalAgentApproval, matchesAgentApproval, MAX_AGENT_APPROVAL_BYTES } from "./approval.js";

describe("agent approval binding", () => {
  it("renders every nested field losslessly in a stable canonical order", () => {
    const a = canonicalAgentApproval("write_tool", { z: "tail", nested: { b: 2, a: "x" }, a: "head" });
    const b = canonicalAgentApproval("write_tool", { a: "head", nested: { a: "x", b: 2 }, z: "tail" });
    expect(a.canonical).toBe(b.canonical);
    expect(a.digest).toBe(b.digest);
    expect(a.display).toContain('"z": "tail"');
    expect(a.display).toContain('"nested"');
    expect(a.display).toContain('"b": 2');
  });

  it("rejects a digest when any approved input field changes", () => {
    const approved = canonicalAgentApproval("write_tool", { command: "deploy --safe", nested: { value: 1 } });
    expect(matchesAgentApproval("write_tool", { command: "deploy --safe", nested: { value: 1 } }, approved.digest)).toBe(true);
    expect(matchesAgentApproval("write_tool", { command: "deploy --safe", nested: { value: 2 } }, approved.digest)).toBe(false);
    expect(matchesAgentApproval("other_tool", { command: "deploy --safe", nested: { value: 1 } }, approved.digest)).toBe(false);
  });

  it("refuses payloads too large to review safely in the terminal", () => {
    expect(() => canonicalAgentApproval("write_tool", { text: "x".repeat(MAX_AGENT_APPROVAL_BYTES) })).toThrow("safe terminal approval is limited");
  });
});

import { describe, expect, it } from "vitest";
import { oneShotApproves, oneShotHelp, parseOneShot } from "./mso-agent-oneshot.mjs";

describe("MSO Agent one-shot CLI contract", () => {
  it("defaults autonomous runs to read-only approvals", () => {
    expect(parseOneShot(["--oneshot", "inspect health", "--json"])).toEqual({ prompt: "inspect health", json: true, approvalScope: "read" });
    expect(oneShotApproves("read", "read")).toBe(true);
    expect(oneShotApproves("read", "write")).toBe(false);
    expect(oneShotApproves("read", "exec")).toBe(false);
  });
  it("requires an explicit scope before autonomous write/exec calls", () => {
    expect(parseOneShot(["-z", "run fixture", "--approve-scope", "write"])?.approvalScope).toBe("write");
    expect(oneShotApproves("write", "write")).toBe(true);
    expect(oneShotApproves("write", "exec")).toBe(false);
    expect(oneShotApproves("exec", "exec")).toBe(true);
    expect(() => parseOneShot(["-z", "x", "--approve-scope", "root"])).toThrow(/read, write, or exec/);
  });
  it("documents that one-shot uses the autonomous agent loop", () => {
    expect(oneShotHelp()).toContain("same autonomous MSO Agent tool loop");
    expect(oneShotHelp()).toContain("Default approval scope is read");
  });
});

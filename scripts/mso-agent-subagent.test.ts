import { describe, expect, it } from "vitest";
import { parseSubagentArgs } from "./mso-agent-subagent.mjs";

describe("interactive /spawn argument contract", () => {
  it("defaults to one read-only foreground worker", () => {
    expect(parseSubagentArgs(["review", "auth"])).toEqual({ objective: "review auth", name: "worker", max_scope: "read" });
  });
  it("supports explicit name/scope/turn cap without changing the objective", () => {
    expect(parseSubagentArgs(["--name", "reviewer", "--scope", "write", "--turns", "8", "fix", "tests"]))
      .toEqual({ objective: "fix tests", name: "reviewer", max_scope: "write", max_turns: 8 });
  });
  it("rejects invalid scope, empty objective, and out-of-range turns", () => {
    expect(() => parseSubagentArgs(["--scope", "root", "x"])).toThrow(/usage:/);
    expect(() => parseSubagentArgs(["--name", "x"])).toThrow(/usage:/);
    expect(() => parseSubagentArgs(["--turns", "99", "x"])).toThrow(/usage:/);
  });
});

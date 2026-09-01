import { describe, expect, it } from "vitest";
import { benchmarkPrompt, buildRunnerPlan, expectedAnswer, sameModelFamily } from "./bench-agent-comparison.mjs";

describe("cross-agent benchmark contract", () => {
  it("requires the answer to depend on file-only values", () => {
    const prompt = benchmarkPrompt("/tmp/private-fixture.json");
    expect(prompt).toContain("filesystem/read tool");
    expect(prompt).not.toContain("17");
    expect(expectedAnswer({ nonce: "abc", alpha: 17, beta: 29, gamma: 41 })).toBe("BENCH:abc:162");
  });
  it("normalizes provider prefixes but not model families", () => {
    expect(sameModelFamily("openai/gpt-5.6-terra", "gpt-5.6-terra")).toBe(true);
    expect(sameModelFamily("openai-codex/gpt-5.6-terra", "gpt-5.6-terra")).toBe(true);
    expect(sameModelFamily("openai/gpt-5.6-sol", "gpt-5.6-terra")).toBe(false);
  });
  it("keeps MSO autonomous approval read-only in the benchmark plan", () => {
    const plan = buildRunnerPlan({ prompt: "p", model: "gpt-5.6-terra", cwd: "/repo", usageFile: "/tmp/u.json" });
    expect(plan.mso.args).not.toContain("--approve-scope");
    expect(plan.hermes.args).toContain("--usage-file");
    expect(plan.openclaw.args).toContain("--local");
  });
});

import { describe, expect, it } from "vitest";
import { classifyTask, gitChangedPaths, sharedResourceWarnings } from "./classifier";

describe("RASMIC risk and contention classifier", () => {
  it("keeps trivial docs work direct without a worktree", () => {
    const result = classifyTask({ intent: "fix a typo in docs only", scope: "write" });
    expect(result).toMatchObject({
      risk: "low",
      complexity: "light",
      isolation: "direct",
      verification: "targeted",
    });
  });

  it("marks contained feature work medium with optional isolation", () => {
    const result = classifyTask({ intent: "implement one contained feature across a few files", scope: "write" });
    expect(result).toMatchObject({ risk: "medium", isolation: "optional-worktree", verification: "affected" });
  });

  it("requires isolated work for high-risk auth/schema/infra work", () => {
    const result = classifyTask({
      intent: "refactor authentication and database schema before production deployment",
      scope: "exec",
    });
    expect(result).toMatchObject({ risk: "high", complexity: "heavy", isolation: "isolated-worktree", verification: "full" });
  });

  it("raises contention before a merge conflict when another workflow and shared files exist", () => {
    const result = classifyTask({
      intent: "upgrade dependencies for the release",
      scope: "exec",
      changedPaths: ["package.json", "src/auth/index.ts"],
      activeProjectWorkflows: 1,
    });
    expect(result.contention).toBe("high");
    expect(result.sharedResourceWarnings.join(" ")).toMatch(/package|deployment/);
  });

  it("extracts changed paths and shared resources from git status lines", () => {
    expect(gitChangedPaths([" M package.json", "R  src/a.ts -> src/b.ts", "?? docs/new.md"])).toEqual([
      "package.json",
      "src/b.ts",
      "docs/new.md",
    ]);
    expect(sharedResourceWarnings("run docker service on port 4173", [])).toEqual(expect.arrayContaining([
      expect.stringContaining("port"),
      expect.stringContaining("container"),
    ]));
  });
});

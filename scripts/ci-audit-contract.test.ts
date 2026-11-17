import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { name?: string; run?: string; "continue-on-error"?: boolean };
type Job = { steps: Step[]; permissions?: Record<string, string>; "continue-on-error"?: boolean };
const workflow = parse(readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8")) as {
  permissions: Record<string, string>;
  jobs: { verify: Job; "dependency-watch": Job };
};

describe("CI dependency audit safeguards", () => {
  it("keeps one strict audit entry point so one waiver map governs", () => {
    const steps = workflow.jobs.verify.steps;
    const strict = steps.findIndex(step => step.run === "bun run audit:strict");
    expect(strict).toBeGreaterThanOrEqual(0);
    expect(steps[strict]["continue-on-error"]).toBeUndefined();
    // A raw `bun audit` here bypasses the waiver map in scripts/audit.mjs.
    expect(steps.some(step => /^bun audit\b/.test(step.run ?? ""))).toBe(false);
    expect(workflow.jobs.verify["continue-on-error"]).toBeUndefined();
  });
  it("retains scheduled strict auditing and read-only workflow authority", () => {
    expect(workflow.jobs["dependency-watch"].steps.some(step => step.run === "bun run audit:strict")).toBe(true);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.verify.permissions).toBeUndefined();
  });
});

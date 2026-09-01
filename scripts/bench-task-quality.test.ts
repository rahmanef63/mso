import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { aggregateTaskQuality, externalAgentContract, runTaskQualityFixture } = await import("./bench-task-quality.mjs");

describe("task quality benchmark", () => {
  it("scores the deterministic telemetry fixture exactly", () => {
    expect(runTaskQualityFixture()).toMatchObject({ passed: true, deterministic: true, quality: { retries: 2, invalidArgSteps: 1, rollbackSignals: 1, averageStepDurationMs: 25 } });
  });
  it("aggregates recipe outcomes and telemetry without inventing coverage for legacy recipes", () => {
    const result = aggregateTaskQuality([
      { attempts: 3, successes: 2, failures: 1, qualityVersion: 1, quality: { stepAttempts: 10, completedSteps: 8, failedSteps: 1, deniedSteps: 0, rateLimitedSteps: 0, invalidArgSteps: 1, retries: 2, rollbackSignals: 1, timedSteps: 4, totalStepDurationMs: 80, averageStepDurationMs: 20 } },
      { attempts: 1, successes: 1, failures: 0 },
    ]);
    expect(result).toMatchObject({ recipes: 2, telemetryRecipes: 1, telemetryCoveragePct: 50, workflowSuccessPct: 75, toolCompletionPct: 80, invalidArgPct: 10, retryPct: 20, averageStepDurationMs: 20 });
  });
  it("requires the same model and exposes non-interactive runners for all agents", () => {
    expect(externalAgentContract.requiresSameModel).toBe(true);
    expect(externalAgentContract.runners.mso.comparable).toBe(true);
    expect(externalAgentContract.runners.hermes.comparable).toBe(true);
    expect(externalAgentContract.runners.openclaw.comparable).toBe(true);
  });
});

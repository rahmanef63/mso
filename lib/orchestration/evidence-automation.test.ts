import { describe, expect, it } from "vitest";
import type { ActiveWorkflow, LearnedRecipe, WorkflowStep } from "@/lib/skills/memory";
import { assessAutomationPromotion, buildAutomationScriptManifest, progressiveVerification, reviewLoopDecision } from "./automation";
import { buildEvidenceReceipt, validateEvidenceReceipt } from "./evidence";

const now = new Date().toISOString();
const orchestration = {
  risk: "high" as const,
  complexity: "heavy" as const,
  contention: "none" as const,
  memoryRelevance: "high" as const,
  isolation: "isolated-worktree" as const,
  verification: "full" as const,
  reasons: ["high-risk domain detected"],
  sharedResourceWarnings: [],
  changedPaths: ["src/auth.ts"],
  affectedPaths: ["src/auth.ts"],
  reservedResources: ["database:development"],
  overlappingPaths: [],
  overlappingResources: [],
  activeProjectWorkflows: 0,
  conflictingWorkflowCount: 0,
  memoryHits: 0,
  contextEstimateTokens: 20,
  cleanupState: "pending" as const,
  workspacePath: "/tmp/project",
  baseCommit: "abc123",
  createdAt: now,
};
const workflow: ActiveWorkflow = {
  id: "wf-test",
  actor: "mcp:test",
  scope: "exec",
  intent: "update authentication before production deployment",
  project: "/tmp/project",
  orchestration,
  startedAt: now,
  steps: [],
};

describe("Evidence Receipt", () => {
  it("refuses a successful high-risk claim without explicit verification evidence", () => {
    const receipt = buildEvidenceReceipt({ workflow, summary: "done", success: true });
    const result = validateEvidenceReceipt(receipt, { success: true, risk: "high" });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/requires explicit/i);
  });

  it("accepts high-risk completion when a concrete test/health/manual proof exists", () => {
    const receipt = buildEvidenceReceipt({
      workflow,
      summary: "deployment verified",
      success: true,
      evidence: {
        claims: ["deployment healthy"],
        tests: ["auth regression suite passed"],
        health: ["HTTP health 200"],
        knownRisks: ["none observed"],
      },
      finalCommit: "def456",
    });
    expect(validateEvidenceReceipt(receipt, { success: true, risk: "high" })).toEqual({ valid: true, errors: [] });
    expect(receipt).toMatchObject({ baseCommit: "abc123", finalCommit: "def456" });
  });

  it("redacts secrets from claims and evidence", () => {
    const receipt = buildEvidenceReceipt({
      workflow,
      summary: "token=super-secret",
      success: false,
      evidence: { claims: ["Authorization: Bearer ghp_1234567890abcdef"] },
    });
    expect(JSON.stringify(receipt)).not.toContain("super-secret");
    expect(JSON.stringify(receipt)).not.toContain("1234567890abcdef");
  });
});

function step(id: string, tool = "sys_stats"): WorkflowStep {
  return { id, tool, state: "completed", durationMs: 5, ts: now };
}
function recipe(overrides: Partial<LearnedRecipe> = {}): LearnedRecipe {
  return {
    id: "recipe-1",
    actor: "mcp:test",
    scope: "read",
    intent: "verify server health",
    normalizedIntent: "verify server health",
    summary: "healthy",
    embeddingVersion: "test",
    embedding: [],
    bestSteps: [step("best")],
    lastSteps: [step("last")],
    attempts: 3,
    successes: 3,
    failures: 0,
    averageDurationMs: 5,
    fastestDurationMs: 5,
    lastDurationMs: 5,
    averageWallDurationMs: 5,
    lastWallDurationMs: 5,
    quality: {
      stepAttempts: 3, completedSteps: 3, failedSteps: 0, deniedSteps: 0,
      rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0,
      timedSteps: 3, totalStepDurationMs: 15, averageStepDurationMs: 5,
    },
    lastQuality: {
      stepAttempts: 1, completedSteps: 1, failedSteps: 0, deniedSteps: 0,
      rateLimitedSteps: 0, invalidArgSteps: 0, retries: 0, rollbackSignals: 0,
      timedSteps: 1, totalStepDurationMs: 5, averageStepDurationMs: 5,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("recipe to script promotion", () => {
  it("does not promote a one-off trace", () => {
    const result = assessAutomationPromotion(recipe({ attempts: 1, successes: 1 }));
    expect(result).toMatchObject({ stage: "observed", scriptCandidate: false });
  });

  it("keeps contextual or mutating routes as recipes even after repetition", () => {
    const execStep = step("exec", "exec_run");
    const result = assessAutomationPromotion(recipe({ bestSteps: [execStep], lastSteps: [execStep] }));
    expect(result.stage).toBe("verified");
    expect(result.scriptCandidate).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/keep it as a recipe/i);
  });

  it("promotes a stable deterministic safe route only after repeated verified success", () => {
    const source = recipe();
    const assessment = assessAutomationPromotion(source);
    expect(assessment).toMatchObject({ stage: "verified", stableSteps: true, scriptCandidate: true, successRate: 1 });
    const manifest = buildAutomationScriptManifest(source, { tested: true });
    expect(manifest).toMatchObject({
      recipeId: source.id,
      status: "tested",
      output: { format: "structured-json" },
      gates: { repeatedPattern: true, stableSteps: true, secretSafe: true, tested: true },
    });
  });
});

describe("review and progressive verification", () => {
  it("uses cheap checks first and reserves the broadest suite for high risk", () => {
    expect(progressiveVerification("low")).toEqual(["targeted check"]);
    expect(progressiveVerification("medium")).toEqual(["targeted check", "affected tests", "build if affected"]);
    expect(progressiveVerification("high").at(-1)).toMatch(/E2E/i);
  });

  it("stops review loops on no-progress, regressions, destructive uncertainty, human decision, or iteration cap", () => {
    expect(reviewLoopDecision({ iteration: 0, maxIterations: 3, actionableFindings: 2 })).toBe("fix");
    expect(reviewLoopDecision({ iteration: 0, maxIterations: 3, actionableFindings: 0 })).toBe("verify");
    expect(reviewLoopDecision({ iteration: 1, maxIterations: 3, actionableFindings: 2, repeatedNoProgress: true })).toBe("stop");
    expect(reviewLoopDecision({ iteration: 3, maxIterations: 3, actionableFindings: 2 })).toBe("stop");
  });
});

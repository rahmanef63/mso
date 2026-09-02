import type { LearnedRecipe, WorkflowStep } from "@/lib/skills/memory";
import type { AutomationAssessment, AutomationScriptManifest } from "./types";

export const REPLAY_SAFE_TOOLS = new Set([
  "fs_list", "fs_read", "fs_search", "fs_usage", "sys_stats", "sys_processes",
  "apps_list", "apps_logs", "projects_list", "project_capabilities", "skills_list",
  "skills_read", "browser_status", "infra_providers_list",
  "dokploy_projects_list", "cloudflare_zones_list",
]);

function successfulTools(steps: WorkflowStep[]): string[] {
  return steps.filter((step) => step.state === "completed").map((step) => step.tool);
}

function similarRoute(recipe: LearnedRecipe): boolean {
  const best = successfulTools(recipe.bestSteps);
  const last = successfulTools(recipe.lastSteps);
  if (!best.length || !last.length) return false;
  const compactLast = last.filter((tool, index) => index === 0 || tool !== last[index - 1]);
  const compactBest = best.filter((tool, index) => index === 0 || tool !== best[index - 1]);
  if (compactBest.length !== compactLast.length) return false;
  return compactBest.every((tool, index) => tool === compactLast[index]);
}

export function isReplaySafeTool(tool: string): boolean { return REPLAY_SAFE_TOOLS.has(tool); }

function replayable(step: WorkflowStep): boolean {
  if (!isReplaySafeTool(step.tool)) return false;
  if (["sys_stats", "sys_processes", "apps_list", "browser_status", "infra_providers_list", "dokploy_projects_list", "cloudflare_zones_list"].includes(step.tool)) return true;
  return Boolean(step.args && Object.keys(step.args).length > 0) || Boolean(step.target);
}

export function assessAutomationPromotion(recipe: LearnedRecipe): AutomationAssessment {
  const attempts = Math.max(0, recipe.attempts || 0);
  const successes = Math.max(0, recipe.successes || 0);
  const failures = Math.max(0, recipe.failures || 0);
  const successRate = attempts ? successes / attempts : 0;
  const stableSteps = attempts >= 2 && similarRoute(recipe);
  let stage: AutomationAssessment["stage"] = "observed";
  const reasons: string[] = [];

  if (successes >= 2 && attempts >= 2) stage = "candidate";
  if (successes >= 3 && successRate >= 0.8 && stableSteps) stage = "verified";

  if (attempts < 2) reasons.push("needs repeated observations");
  if (successes < 2) reasons.push("needs at least two successful runs for a recipe candidate");
  if (!stableSteps) reasons.push("tool route is not stable across successful runs yet");
  if (failures > 0 && successRate < 0.8) reasons.push("success rate is below the verification gate");

  const replaySafe = recipe.bestSteps.length > 0 && recipe.bestSteps.length <= 12 && recipe.bestSteps.every(replayable);
  if (recipe.bestSteps.length > 12) reasons.push("route is too long for bounded script replay; keep it as a recipe");
  else if (!replaySafe) reasons.push("route contains contextual or non-replay-safe steps; keep it as a recipe");
  const scriptCandidate = stage === "verified" && replaySafe;

  return {
    stage,
    successRate: Math.round(successRate * 1000) / 1000,
    stableSteps,
    scriptCandidate,
    reasons: [...new Set(reasons)].slice(0, 10),
  };
}

export function buildAutomationScriptManifest(recipe: LearnedRecipe, options: { tested?: boolean } = {}): AutomationScriptManifest {
  const assessment = assessAutomationPromotion(recipe);
  if (!assessment.scriptCandidate) throw new Error("recipe has not passed script promotion gates");
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: `script_${recipe.id}`,
    recipeId: recipe.id,
    status: options.tested ? "tested" : "candidate",
    intent: recipe.intent,
    ...(recipe.project ? { project: recipe.project } : {}),
    steps: recipe.bestSteps.map((step) => ({ tool: step.tool, ...(step.args ? { args: step.args } : {}) })),
    output: { format: "structured-json" },
    gates: {
      repeatedPattern: recipe.attempts >= 2,
      stableSteps: assessment.stableSteps,
      clearInputs: true,
      clearOutputs: true,
      sideEffectsUnderstood: true,
      secretSafe: true,
      tested: options.tested === true,
    },
    createdAt: recipe.createdAt || now,
    updatedAt: now,
  };
}

export type ReviewLoopState = {
  iteration: number;
  maxIterations: number;
  actionableFindings: number;
  repeatedNoProgress?: boolean;
  newRegressions?: boolean;
  destructiveUncertainty?: boolean;
  humanDecisionRequired?: boolean;
};

export function reviewLoopDecision(state: ReviewLoopState): "fix" | "verify" | "stop" {
  if (state.iteration >= state.maxIterations) return "stop";
  if (state.repeatedNoProgress || state.newRegressions || state.destructiveUncertainty || state.humanDecisionRequired) return "stop";
  if (state.actionableFindings > 0) return "fix";
  return "verify";
}

export function progressiveVerification(risk: "low" | "medium" | "high"): string[] {
  if (risk === "low") return ["targeted check"];
  if (risk === "medium") return ["targeted check", "affected tests", "build if affected"];
  return ["targeted check", "affected tests", "build", "broader regression", "E2E/release verification when applicable"];
}

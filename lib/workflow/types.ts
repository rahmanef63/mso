import type { Scope } from "@/lib/capabilities/scope";
import type { WorkflowOrchestrationSnapshot } from "@/lib/contracts/orchestration";

export type WorkflowStepState = "completed" | "failed" | "denied" | "rate_limited" | "invalid_args";

export type WorkflowStep = {
  id: string;
  tool: string;
  state: WorkflowStepState;
  target?: string;
  args?: Record<string, string | number | boolean>;
  durationMs?: number;
  ts: string;
};

export type WorkflowStepInput = Omit<WorkflowStep, "args"> & { args?: Record<string, unknown> };

export type ActiveWorkflow = {
  id: string;
  actor: string;
  scope: Scope;
  intent: string;
  project?: string;
  constraints?: string;
  orchestration?: WorkflowOrchestrationSnapshot;
  startedAt: string;
  steps: WorkflowStep[];
};

export type WorkflowQuality = {
  stepAttempts: number; completedSteps: number; failedSteps: number; deniedSteps: number;
  rateLimitedSteps: number; invalidArgSteps: number; retries: number; rollbackSignals: number;
  timedSteps: number; totalStepDurationMs: number; averageStepDurationMs: number;
};

export type LearnedRecipe = {
  id: string;
  actor: string;
  scope: Scope;
  intent: string;
  normalizedIntent: string;
  project?: string;
  summary: string;
  embeddingVersion: string;
  embedding: number[];
  bestSteps: WorkflowStep[];
  lastSteps: WorkflowStep[];
  attempts: number;
  successes: number;
  failures: number;
  averageDurationMs: number;
  fastestDurationMs?: number;
  lastDurationMs: number;
  averageWallDurationMs: number;
  lastWallDurationMs: number;
  quality: WorkflowQuality;
  lastQuality: WorkflowQuality;
  qualityVersion?: 1;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type ActiveWorkflowBuckets = Record<string, Record<string, ActiveWorkflow>>;
export type WorkflowStoreState = {
  version: 3;
  active: ActiveWorkflowBuckets;
  recipes: Record<string, LearnedRecipe>;
};

export type FinishWorkflowResult = {
  workflow: ActiveWorkflow;
  recipe: LearnedRecipe;
  currentDurationMs: number;
  previousFastestMs?: number;
  improvedByMs?: number;
  improvedPct?: number;
};

export type CancelWorkflowResult = { workflow: ActiveWorkflow; reason?: string };
export type RecipeAccess =
  | { actor: string; scope: Scope; ownerView?: false }
  | { ownerView: true; actor?: never; scope?: never };

export type ProjectContentionSummary = {
  activeWorkflowCount: number;
  conflictingWorkflowCount: number;
  overlappingPaths: string[];
  overlappingResources: string[];
};

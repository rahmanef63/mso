import type { Scope } from "@/lib/mcp/scope";
import type { WorkflowQuality, WorkflowStep } from "@/lib/skills/memory";

export const FORGE_VERSION = 1 as const;
export type ForgeKind = "skill" | "project_function";
export type ForgeState = "draft" | "evaluated" | "promoted";
export type ForgeCheckState = "pass" | "fail" | "warn";

export type ForgeCheck = {
  id: string;
  state: ForgeCheckState;
  detail: string;
};

export type ForgeFixtureExpectation = {
  code?: number;
  stdoutIncludes?: string;
  stderrExcludes?: string;
};

export type ForgeFixture = {
  name: string;
  input: Record<string, unknown>;
  expect?: ForgeFixtureExpectation;
};

export type ForgeRecipeSnapshot = {
  id: string;
  scope: Scope;
  intent: string;
  summary: string;
  attempts: number;
  successes: number;
  failures: number;
  qualityVersion?: 1;
  quality: WorkflowQuality;
  bestSteps: Pick<WorkflowStep, "tool" | "state" | "target">[];
  updatedAt: string;
};

export type ForgeSkillSpec = {
  name: string;
  content: string;
};

export type ForgeFunctionSpec = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  command: string[];
  timeoutMs: number;
  fixtures: ForgeFixture[];
};

export type ForgeEvaluation = {
  version: 1;
  candidateHash: string;
  passed: boolean;
  evaluatedAt: string;
  checks: ForgeCheck[];
  targetHash?: string;
  toolsetHash?: string;
  fixtureCount: number;
  sandboxImageId?: string;
  sourceHash?: string;
};

export type ForgePromotion = {
  at: string;
  path: string;
  verification: string;
};

export type ForgeCandidate = {
  version: 1;
  id: string;
  ownerHash: string;
  kind: ForgeKind;
  state: ForgeState;
  projectPath: string;
  recipe: ForgeRecipeSnapshot;
  requiredScope: Scope;
  createdAt: string;
  updatedAt: string;
  skill?: ForgeSkillSpec;
  function?: ForgeFunctionSpec;
  evaluation?: ForgeEvaluation;
  promotion?: ForgePromotion;
};

export type PublicForgeCandidate = Omit<ForgeCandidate, "ownerHash" | "function"> & {
  function?: Omit<ForgeFunctionSpec, "command" | "fixtures"> & {
    command?: { executable: string; argvCount: number };
    fixtureCount: number;
  };
};

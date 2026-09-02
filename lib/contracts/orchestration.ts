export type RiskLevel = "low" | "medium" | "high";
export type ComplexityLevel = "light" | "medium" | "heavy";
export type ContentionLevel = "none" | "possible" | "high";
export type MemoryRelevance = "low" | "medium" | "high";
export type IsolationMode = "direct" | "optional-worktree" | "isolated-worktree";
export type VerificationLevel = "targeted" | "affected" | "full";
export type CleanupState = "not-required" | "pending" | "complete";

export type TaskClassification = {
  risk: RiskLevel;
  complexity: ComplexityLevel;
  contention: ContentionLevel;
  memoryRelevance: MemoryRelevance;
  isolation: IsolationMode;
  verification: VerificationLevel;
  reasons: string[];
  sharedResourceWarnings: string[];
};

export type WorkflowOrchestrationSnapshot = TaskClassification & {
  baseCommit?: string;
  baseBranch?: string;
  changedPaths: string[];
  affectedPaths: string[];
  reservedResources: string[];
  overlappingPaths: string[];
  overlappingResources: string[];
  activeProjectWorkflows: number;
  conflictingWorkflowCount: number;
  memoryHits: number;
  contextEstimateTokens: number;
  cleanupState: CleanupState;
  workspacePath?: string;
  recipeUsed?: string;
  createdAt: string;
};

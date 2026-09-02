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

export type EvidenceStatus = "pass" | "fail" | "warn" | "not-run";

export type EvidenceItem = {
  name: string;
  status: EvidenceStatus;
  detail?: string;
};

export type EvidenceReceipt = {
  schemaVersion: 1;
  workflow: string;
  repo?: string;
  baseCommit?: string;
  finalCommit?: string;
  environment?: string;
  claims: string[];
  tests: EvidenceItem[];
  build: EvidenceItem[];
  deployment: EvidenceItem[];
  health: EvidenceItem[];
  artifacts: string[];
  manualVerification: EvidenceItem[];
  knownRisks: string[];
  createdAt: string;
};

export type EvidenceInput = Partial<{
  environment: string;
  claims: string[];
  tests: string[];
  build: string[];
  deployment: string[];
  health: string[];
  artifacts: string[];
  manualVerification: string[];
  knownRisks: string[];
}>;

export type RepoMemoryKind = "task" | "debug" | "test" | "decision" | "failure";
export type RepoMemoryLifecycle = "active" | "confirmed" | "superseded" | "archived";
export type RepoMemorySource = "agent" | "system" | "user-manual" | "automation";
export type RepoMemoryResult = "pass" | "fail" | "unknown";

export type RepoMemoryRecord = {
  schemaVersion: 1;
  id: string;
  kind: RepoMemoryKind;
  status: RepoMemoryLifecycle;
  title: string;
  summary: string;
  source: RepoMemorySource;
  result?: RepoMemoryResult;
  observation?: string;
  happened?: string;
  learned?: string;
  failed?: string;
  worked?: string;
  reuse?: string;
  confidence: number;
  importance: number;
  lastVerified?: string;
  scope: string[];
  tags: string[];
  commit?: string;
  environment?: string;
  supersedes: string[];
  createdAt: string;
  updatedAt: string;
};

export type RepoMemorySearchHit = {
  record: RepoMemoryRecord;
  score: number;
  ageDays: number;
};

export type AutomationStage = "observed" | "candidate" | "verified";
export type AutomationAssessment = {
  stage: AutomationStage;
  successRate: number;
  stableSteps: boolean;
  scriptCandidate: boolean;
  reasons: string[];
};

export type AutomationScriptManifest = {
  schemaVersion: 1;
  id: string;
  recipeId: string;
  status: "candidate" | "tested";
  intent: string;
  project?: string;
  steps: Array<{ tool: string; args?: Record<string, string | number | boolean> }>;
  output: { format: "structured-json" };
  gates: {
    repeatedPattern: boolean;
    stableSteps: boolean;
    clearInputs: boolean;
    clearOutputs: boolean;
    sideEffectsUnderstood: boolean;
    secretSafe: boolean;
    tested: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

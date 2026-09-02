export type {
  RiskLevel,
  ComplexityLevel,
  ContentionLevel,
  MemoryRelevance,
  IsolationMode,
  VerificationLevel,
  CleanupState,
  TaskClassification,
  WorkflowOrchestrationSnapshot,
} from "@/lib/contracts/orchestration";

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

export type RepoMemoryRelationType = "supersedes" | "superseded-by" | "conflicts-with" | "related";
export type RepoMemoryRelation = {
  type: RepoMemoryRelationType;
  targetId: string;
  targetKind: RepoMemoryKind;
  title: string;
  score: number;
  reasons: string[];
};

export type RepoMemoryTimelineEvent = {
  id: string;
  kind: RepoMemoryKind;
  status: RepoMemoryLifecycle;
  source: RepoMemorySource;
  result?: RepoMemoryResult;
  title: string;
  summary: string;
  at: string;
  commit?: string;
  environment?: string;
};

export type RepoMemoryBundle = {
  schemaVersion: 1;
  exportedAt: string;
  records: RepoMemoryRecord[];
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

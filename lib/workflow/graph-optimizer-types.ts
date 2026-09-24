export type WorkflowOptimizerRisk = "safe" | "review";
export type WorkflowOptimizerCandidateKind = "presentation-group" | "loop-compaction";
export type WorkflowOptimizerCandidate = {
  id: string;
  kind: WorkflowOptimizerCandidateKind;
  title: string;
  description: string;
  nodeIds: string[];
  risk: WorkflowOptimizerRisk;
  estimatedNodeDelta: number;
  hostEligible: true;
  probability?: number;
  selected?: boolean;
  reason?: string;
};

export type WorkflowOptimizerDecisionMode = "deterministic" | "jev";
export type WorkflowOptimizerEvaluation = {
  provider: "deterministic" | "jev" | "fallback";
  probabilities: Record<string, number>;
  fallbackReason?: string;
};

export type WorkflowOptimizerEvaluator = (
  state: Record<string, unknown>,
  candidates: WorkflowOptimizerCandidate[],
) => Promise<WorkflowOptimizerEvaluation>;

export type WorkflowOptimizationPreview = {
  version: 1;
  source: { id: string; revision: string; name: string; nodeCount: number; edgeCount: number };
  mode: WorkflowOptimizerDecisionMode;
  provider: WorkflowOptimizerEvaluation["provider"];
  threshold: number;
  candidates: WorkflowOptimizerCandidate[];
  selectedCandidateIds: string[];
  reviewCandidateIds: string[];
  summary: {
    candidateCount: number;
    selectedCount: number;
    reviewCount: number;
    beforeNodes: number;
    afterNodes: number;
    beforeEdges: number;
    afterEdges: number;
    visualGroupsAdded: number;
    nodeReduction: number;
    edgeReduction: number;
  };
  fallbackReason?: string;
  shadow?: { baseline: "deterministic"; compared: "jev"; agreement: number; disagreements: string[] };
};

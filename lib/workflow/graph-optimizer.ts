import type { WorkflowGraph } from "@/lib/contracts/workflow-graph";
import type { CapabilityTool } from "@/lib/capabilities/tool";
import { workflowOptimizerCandidates } from "./graph-optimizer-candidates";

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

function optimizerState(graph: WorkflowGraph, candidates: WorkflowOptimizerCandidate[]): Record<string, unknown> {
  return {
    objective: "Compact the workflow while preserving semantics, bounded execution, permissions, and debuggability.",
    workflow: {
      name: graph.name,
      description: graph.description.slice(0, 400),
      status: graph.status,
      provenance: graph.metadata.provenance ?? "user",
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodeTypes: graph.nodes.map((node) => node.type),
    },
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      risk: candidate.risk,
      title: candidate.title,
      description: candidate.description,
      affectedNodeCount: candidate.nodeIds.length,
      estimatedNodeDelta: candidate.estimatedNodeDelta,
    })),
    policy: {
      safeCandidatesMayAutoApply: true,
      reviewCandidatesRequireExplicitApplyReview: true,
      jevCannotCreateCallsOrBypassMsoPolicy: true,
    },
  };
}

function deterministicEvaluation(candidates: WorkflowOptimizerCandidate[]): WorkflowOptimizerEvaluation {
  return {
    provider: "deterministic",
    probabilities: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.risk === "safe" ? 0.96 : 0.72])),
  };
}

function withoutRuntimeFields(graph: WorkflowGraph) {
  const { version: _version, id: _id, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...definition } = graph;
  return definition;
}

function shadowEvaluation(
  mode: WorkflowOptimizerDecisionMode,
  evaluation: WorkflowOptimizerEvaluation,
  baseline: WorkflowOptimizerEvaluation,
  candidates: WorkflowOptimizerCandidate[],
  threshold: number,
): WorkflowOptimizationPreview["shadow"] {
  if (mode !== "jev" || evaluation.provider !== "jev") return undefined;
  const disagreements = candidates.filter((candidate) => {
    const base = (baseline.probabilities[candidate.id] ?? 0) >= threshold;
    const jev = (evaluation.probabilities[candidate.id] ?? 0) >= threshold;
    return base !== jev;
  }).map((candidate) => candidate.id);
  const agreement = candidates.length ? (candidates.length - disagreements.length) / candidates.length : 1;
  return { baseline: "deterministic", compared: "jev", agreement: Math.round(agreement * 1000) / 1000, disagreements };
}

export async function optimizeWorkflowGraph(graph: WorkflowGraph, options: {
  mode?: WorkflowOptimizerDecisionMode;
  threshold?: number;
  applyReview?: boolean;
  evaluator?: WorkflowOptimizerEvaluator;
  resolveTool?: (name: string) => CapabilityTool | undefined;
} = {}) {
  const mode = options.mode ?? "deterministic";
  const threshold = Math.max(0.5, Math.min(0.99, Number(options.threshold) || 0.72));
  const internal = workflowOptimizerCandidates(graph, options.resolveTool);
  const publicCandidates: WorkflowOptimizerCandidate[] = internal.map(({ apply: _apply, ...candidate }) => candidate);
  const baseline = deterministicEvaluation(publicCandidates);
  let evaluation = baseline;
  if (mode === "jev" && options.evaluator && publicCandidates.length) {
    try {
      evaluation = await options.evaluator(optimizerState(graph, publicCandidates), publicCandidates);
    } catch (error) {
      evaluation = {
        provider: "fallback",
        probabilities: baseline.probabilities,
        fallbackReason: error instanceof Error ? error.message.slice(0, 240) : "Jev evaluation failed",
      };
    }
  }
  const shadow = shadowEvaluation(mode, evaluation, baseline, publicCandidates, threshold);
  const selected = internal.filter((candidate) => {
    const probability = evaluation.probabilities[candidate.id] ?? (candidate.risk === "safe" ? 0.96 : 0.72);
    return probability >= threshold && (candidate.risk === "safe" || options.applyReview === true);
  });
  let optimized = structuredClone(graph);
  for (const candidate of selected.filter((row) => row.kind === "loop-compaction")) optimized = candidate.apply(optimized);
  for (const candidate of selected.filter((row) => row.kind === "presentation-group")) optimized = candidate.apply(optimized);
  const candidates = publicCandidates.map((candidate) => ({
    ...candidate,
    probability: Math.round((evaluation.probabilities[candidate.id] ?? 0) * 1000) / 1000,
    selected: selected.some((row) => row.id === candidate.id),
    reason: candidate.risk === "review" && options.applyReview !== true ? "Requires explicit apply_review=true." : undefined,
  }));
  const preview: WorkflowOptimizationPreview = {
    version: 1,
    source: { id: graph.id, revision: graph.revision, name: graph.name, nodeCount: graph.nodes.length, edgeCount: graph.edges.length },
    mode,
    provider: evaluation.provider,
    threshold,
    candidates,
    selectedCandidateIds: selected.map((candidate) => candidate.id),
    reviewCandidateIds: candidates.filter((candidate) => candidate.risk === "review").map((candidate) => candidate.id),
    summary: {
      candidateCount: candidates.length,
      selectedCount: selected.length,
      reviewCount: candidates.filter((candidate) => candidate.risk === "review").length,
      beforeNodes: graph.nodes.length,
      afterNodes: optimized.nodes.length,
      beforeEdges: graph.edges.length,
      afterEdges: optimized.edges.length,
      visualGroupsAdded: Math.max(0, (optimized.metadata.customNodes?.length ?? 0) - (graph.metadata.customNodes?.length ?? 0)),
      nodeReduction: graph.nodes.length - optimized.nodes.length,
      edgeReduction: graph.edges.length - optimized.edges.length,
    },
    ...(evaluation.fallbackReason ? { fallbackReason: evaluation.fallbackReason } : {}),
    ...(shadow ? { shadow } : {}),
  };
  return { preview, definition: withoutRuntimeFields(optimized) };
}
